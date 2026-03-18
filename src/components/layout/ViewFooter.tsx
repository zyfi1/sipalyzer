/**
 * Unified compact footer bar for all views.
 * Displays status indicators, stats, and counts at the bottom of the view.
 */

import { createPortal } from "react-dom";
import { useContext, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ActiveToolPanelContext } from "@/components/layout/ToolContainer";

interface ViewFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function ViewFooter({ children, className }: ViewFooterProps) {
  const panel = useContext(ActiveToolPanelContext);
  const [footerHost, setFooterHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setFooterHost(document.getElementById("app-global-footer-layer"));
  }, []);

  // Multiple tools stay mounted for fast switching; only active tool should render its footer.
  if (panel && !panel.isActive) return null;
  // Prevents inline fallback flashes before the global footer layer is mounted.
  if (!footerHost) return null;

  const footer = (
    <div
      className={cn(
        "h-full px-3 flex items-center gap-3 text-xs select-none rounded-none w-full pointer-events-auto app-chrome-surface app-chrome-content-swap",
        className,
      )}
    >
      {children}
    </div>
  );

  return createPortal(footer, footerHost);
}

interface ViewFooterItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function ViewFooterItem({ children, onClick, className }: ViewFooterItemProps) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 text-muted-foreground",
        onClick && "hover:text-foreground transition-smooth cursor-pointer ui-hover-press motion-reduce:transform-none",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

export function ViewFooterSpacer() {
  return <div className="flex-1" />;
}

export function ViewFooterDivider() {
  return <div className="w-px h-4 bg-border" />;
}
