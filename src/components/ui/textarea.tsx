import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, onDoubleClick, ...props }: React.ComponentProps<"textarea">) {
  const handleDoubleClick = React.useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      (e.target as HTMLTextAreaElement).select();
      onDoubleClick?.(e);
    },
    [onDoubleClick]
  );
  return (
    <textarea
      data-slot="textarea"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      className={cn(
        "ui-control-shell placeholder:text-muted-foreground selection:bg-accent selection:text-foreground flex field-sizing-content min-h-16 w-full px-3 py-2 text-base outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-foreground/30 aria-invalid:border-destructive/60",
        className
      )}
      {...props}
      onDoubleClick={handleDoubleClick}
    />
  )
}

export { Textarea }
