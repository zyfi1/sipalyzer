/**
 * Styled primitives for the app-wide Radix **Context** menu (right-click).
 * Separate from `dropdown-menu.tsx` so menu scope/submenus stay correct.
 */
import * as React from "react";
import { ChevronRightIcon } from "@/lib/icons";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Radix Popper reads `getComputedStyle(content).zIndex` for the floating **wrapper**.
 * If it is missing/`auto` on first paint, the menu can sit under `.sidebarRail` (z-index: 20).
 */
const APP_CONTEXT_MENU_Z = 100_000;
const APP_CONTEXT_MENU_SUB_Z = 100_010;

function AppContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="app-context-menu" {...props} />;
}

const AppContextMenuTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>
>(({ ...props }, ref) => (
  <ContextMenuPrimitive.Trigger ref={ref} data-slot="app-context-menu-trigger" {...props} />
));
AppContextMenuTrigger.displayName = "AppContextMenuTrigger";

type AppContextMenuContentProps = React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  style?: React.CSSProperties;
};

function AppContextMenuContent({
  className,
  style,
  collisionPadding = 8,
  ...rest
}: AppContextMenuContentProps) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="app-context-menu-content"
        collisionPadding={collisionPadding}
        style={{
          zIndex: APP_CONTEXT_MENU_Z,
          /* Full intrinsic height — no internal scroll. Override surface `overflow: hidden`. */
          overflow: "visible",
          maxHeight: "none",
          ...style,
        }}
        className={cn(
          "ui-floating-surface ui-floating-content text-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-[100000] min-w-[8rem] max-h-none origin-(--radix-context-menu-content-transform-origin)",
          className,
        )}
        {...rest}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function AppContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="app-context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "ui-floating-item data-[highlighted]:bg-accent/28 data-[highlighted]:text-accent-foreground focus:bg-accent/28 focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 dark:data-[variant=destructive]:data-[highlighted]:bg-destructive/20 data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:data-[highlighted]:text-destructive data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 px-2 text-sm outline-hidden select-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function AppContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="app-context-menu-label"
      data-inset={inset}
      className={cn("px-2 py-1.5 text-sm font-medium data-[inset]:pl-8", className)}
      {...props}
    />
  );
}

function AppContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="app-context-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

function AppContextMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="app-context-menu-shortcut"
      className={cn("text-muted-foreground ml-auto text-xs tracking-widest", className)}
      {...props}
    />
  );
}

function AppContextMenuSub({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="app-context-menu-sub" {...props} />;
}

function AppContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="app-context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "ui-floating-item data-[highlighted]:bg-accent/28 data-[highlighted]:text-accent-foreground focus:bg-accent/28 focus:text-accent-foreground data-[state=open]:bg-accent/28 data-[state=open]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex cursor-default items-center gap-2 px-2 text-sm outline-hidden select-none transition-colors data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

type AppContextMenuSubContentProps = React.ComponentProps<typeof ContextMenuPrimitive.SubContent> & {
  style?: React.CSSProperties;
};

function AppContextMenuSubContent({ className, style, ...rest }: AppContextMenuSubContentProps) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        data-slot="app-context-menu-sub-content"
        sideOffset={6}
        collisionPadding={8}
        style={{
          zIndex: APP_CONTEXT_MENU_SUB_Z,
          overflow: "visible",
          maxHeight: "none",
          ...style,
        }}
        className={cn(
          "ui-floating-surface ui-floating-content text-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-[100010] min-w-[8rem] max-h-none origin-(--radix-context-menu-content-transform-origin)",
          className,
        )}
        {...rest}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export {
  AppContextMenu,
  AppContextMenuTrigger,
  AppContextMenuContent,
  AppContextMenuItem,
  AppContextMenuLabel,
  AppContextMenuSeparator,
  AppContextMenuShortcut,
  AppContextMenuSub,
  AppContextMenuSubTrigger,
  AppContextMenuSubContent,
};
