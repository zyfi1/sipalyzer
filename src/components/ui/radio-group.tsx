"use client"

import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  size = "md",
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item> & {
  size?: "sm" | "md" | "lg"
}) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      data-size={size}
      className={cn(
        "text-foreground bg-secondary aspect-square shrink-0 rounded-[calc(var(--radius-md)-2px)] transition-[color,box-shadow,background-color,border-color,transform] duration-[320ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none outline-none disabled:cursor-not-allowed disabled:opacity-50 border border-border/50 focus-visible:shadow-focus data-[state=checked]:border-transparent data-[state=checked]:bg-primary data-[state=checked]:shadow-none data-[size=sm]:size-3.5 data-[size=md]:size-4 data-[size=lg]:size-5 active:scale-[0.985] motion-reduce:active:scale-100",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center transition-opacity duration-[280ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none data-[state=checked]:opacity-100 data-[state=checked]:animate-control-radio-indicator-pop motion-reduce:data-[state=checked]:animate-none data-[state=unchecked]:opacity-0"
      >
        <span
          className={cn(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[4px] border border-primary-foreground/60 animate-control-radio-ring motion-reduce:animate-none",
            size === "sm" ? "size-2.5" : size === "lg" ? "size-4" : "size-3"
          )}
        />
        <span
          className={cn(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary-foreground rounded-[2px]",
            size === "sm" ? "size-1.5" : size === "lg" ? "size-2.5" : "size-2"
          )}
        />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
