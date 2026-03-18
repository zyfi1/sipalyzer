/**
 * Consistent subheader bar for all views.
 * Styled to match the Home view's WorkspaceStatusBar.
 */

import { cn } from "@/lib/utils";

interface ViewSubheaderProps {
  children: React.ReactNode;
  className?: string;
}

export function ViewSubheader({ children, className }: ViewSubheaderProps) {
  return (
    <div className={cn(
      "surface-subtle app-chrome-surface app-chrome-content-swap flex min-h-[var(--ui-control-height)] items-center gap-4 border-b border-border/45 px-4 py-1.5 text-sm",
      className
    )}>
      {children}
    </div>
  );
}

interface ViewSubheaderItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function ViewSubheaderItem({ children, onClick, className }: ViewSubheaderItemProps) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2",
        onClick && "hover:text-foreground transition-smooth ui-hover-press motion-reduce:transform-none outline-none focus-visible:shadow-focus",
        className
      )}
    >
      {children}
    </Comp>
  );
}

interface ViewSubheaderCountProps {
  count: number;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
}

export function ViewSubheaderCount({ count, label, icon, onClick }: ViewSubheaderCountProps) {
  return (
    <ViewSubheaderItem onClick={onClick} className="text-muted-foreground">
      {icon}
      <span className="text-foreground font-medium tabular-nums">{count}</span>
      <span>{label}</span>
    </ViewSubheaderItem>
  );
}

export function ViewSubheaderSpacer() {
  return <div className="flex-1" />;
}
