import { cn } from "@/lib/utils";

interface GradientBorderCardProps extends React.HTMLAttributes<HTMLDivElement> {
  borderColor?: string;
}

/**
 * Card with animated conic gradient border on hover.
 * Uses @property --border-angle (defined in styles.css) for smooth CSS animation.
 * Best used sparingly on hero cards, CTAs, and primary interactive surfaces.
 */
export function GradientBorderCard({
  children,
  className,
  borderColor = "hsl(var(--primary))",
  style,
  ...props
}: GradientBorderCardProps) {
  return (
    <div
      className={cn(
        "gradient-border-card relative isolate rounded-lg",
        className,
      )}
      style={{ "--gradient-border-color": borderColor, ...style } as React.CSSProperties}
      {...props}
    >
      {children}
    </div>
  );
}
