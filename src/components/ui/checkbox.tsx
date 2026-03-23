"use client"

import * as React from "react"
import { Tick } from "@/lib/icons"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  size = "md",
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  size?: "sm" | "md" | "lg"
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      data-size={size}
      className={cn(
        "peer shrink-0 rounded-md border border-border/80 bg-muted/40 transition-[background-color,border-color,color,box-shadow,transform] duration-[320ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none outline-none data-[size=sm]:size-3.5 data-[size=md]:size-4 data-[size=lg]:size-5",
        "data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground",
        "data-[state=checked]:shadow-none",
        "hover:border-muted-foreground/50 hover:bg-muted/50 hover:data-[state=checked]:brightness-110",
        "focus-visible:shadow-focus",
        "active:scale-[0.985] motion-reduce:active:scale-100",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-opacity duration-[280ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none data-[state=checked]:opacity-100 data-[state=checked]:animate-control-checkmark-overshoot motion-reduce:data-[state=checked]:animate-none data-[state=unchecked]:opacity-0"
      >
        <Tick className={cn(size === "sm" ? "size-2.5" : size === "lg" ? "size-4" : "size-3")} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
