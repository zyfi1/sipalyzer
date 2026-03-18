"use client"

import * as React from "react"
import { Tick } from "@/lib/icons"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-md border border-border/80 bg-muted/40 transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)] outline-none",
        "data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground",
        "data-[state=checked]:shadow-[0_0_6px_hsl(var(--primary)/0.35)]",
        "hover:border-muted-foreground/50 hover:bg-muted/50 hover:data-[state=checked]:brightness-110",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current animate-in zoom-in-75 duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]"
      >
        <Tick className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
