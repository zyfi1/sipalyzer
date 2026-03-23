"use client"

import * as React from "react"
import { XIcon } from "@/lib/icons"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const container = typeof document !== "undefined" ? document.body : undefined
  return <DialogPrimitive.Portal data-slot="dialog-portal" container={container} {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "graphite-modal-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-[var(--motion-duration-overlay)] fixed inset-0 z-[10100]",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  layout = "center",
  tone = "neutral",
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  layout?: "center" | "left-sheet"
  tone?: "neutral" | "success" | "destructive"
}) {
  const isLeftSheet = layout === "left-sheet"

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      {isLeftSheet ? (
        <DialogPrimitive.Content
          data-slot="dialog-content"
          data-tone={tone}
          className={cn(
            "graphite-modal-content text-card-foreground fixed z-[10101] grid gap-4 overflow-y-auto p-5 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)] outline-none left-2 inset-y-2 translate-x-0 w-[min(760px,calc(100vw-1rem))] max-w-[min(760px,calc(100vw-1rem))] max-h-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-left-6 data-[state=open]:slide-in-from-left-6 border data-[tone=neutral]:border-border/60 data-[tone=success]:border-success/45 data-[tone=destructive]:border-destructive/45",
            className
          )}
          {...props}
          style={style}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="ui-control-shell ui-hover-press motion-reduce:transform-none text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-md p-1 transition-smooth focus-visible:shadow-focus outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      ) : (
        <div className="fixed inset-0 z-[10101] flex items-center justify-center p-4 pointer-events-none">
          <DialogPrimitive.Content
            data-slot="dialog-content"
            data-tone={tone}
            className={cn(
              "graphite-modal-content text-card-foreground relative grid w-full max-w-[calc(100%-2rem)] sm:max-w-lg max-h-[calc(min(100vh,100dvh)-2rem)] gap-4 overflow-y-auto p-5 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)] outline-none pointer-events-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 border data-[tone=neutral]:border-border/60 data-[tone=success]:border-success/45 data-[tone=destructive]:border-destructive/45",
              className
            )}
            {...props}
            style={{
              maxHeight: "calc(min(100vh, 100dvh) - 2rem)",
              ...style,
            }}
          >
            {children}
            {showCloseButton && (
              <DialogPrimitive.Close
                data-slot="dialog-close"
                className="ui-control-shell ui-hover-press motion-reduce:transform-none text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-md p-1 transition-smooth focus-visible:shadow-focus outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </DialogPrimitive.Content>
        </div>
      )}
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
