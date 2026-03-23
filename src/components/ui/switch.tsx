import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "md",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "md" | "lg" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center rounded-[var(--radius-md)] border transition-[background-color,border-color,box-shadow,transform] duration-[320ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary/92 data-[state=checked]:border-primary/55 data-[state=unchecked]:bg-muted/55 data-[state=unchecked]:border-border/72 data-[state=checked]:shadow-none data-[size=sm]:h-4 data-[size=sm]:w-7 data-[size=md]:h-5 data-[size=md]:w-9 data-[size=default]:h-5 data-[size=default]:w-9 data-[size=lg]:h-6 data-[size=lg]:w-11 focus-visible:shadow-focus active:scale-[0.985] motion-reduce:active:scale-100",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-[calc(var(--radius-md)-2px)] ring-0 transition-[transform,background-color,box-shadow] duration-[380ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none data-[state=unchecked]:bg-foreground/88 data-[state=checked]:bg-primary-foreground data-[state=checked]:shadow-none data-[state=checked]:animate-control-switch-thumb-bounce motion-reduce:data-[state=checked]:animate-none group-data-[size=sm]/switch:h-3 group-data-[size=sm]/switch:w-3 group-data-[size=md]/switch:h-4 group-data-[size=md]/switch:w-4 group-data-[size=default]/switch:h-4 group-data-[size=default]/switch:w-4 group-data-[size=lg]/switch:h-5 group-data-[size=lg]/switch:w-5 data-[state=unchecked]:translate-x-[1px] group-data-[size=sm]/switch:data-[state=checked]:translate-x-[13px] group-data-[size=md]/switch:data-[state=checked]:translate-x-[17px] group-data-[size=default]/switch:data-[state=checked]:translate-x-[17px] group-data-[size=lg]/switch:data-[state=checked]:translate-x-[21px]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
