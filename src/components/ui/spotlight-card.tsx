import { useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  spotlightSize?: number;
  spotlightOpacity?: number;
}

export function SpotlightCard({
  children,
  className,
  spotlightSize = 350,
  spotlightOpacity = 0.08,
  ...props
}: SpotlightCardProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!overlayRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      overlayRef.current.style.background = `radial-gradient(${spotlightSize}px at ${x}px ${y}px, hsl(var(--primary) / ${spotlightOpacity}), transparent 70%)`;
    },
    [spotlightSize, spotlightOpacity],
  );

  const handleMouseLeave = useCallback(() => {
    if (overlayRef.current) {
      overlayRef.current.style.background = "none";
    }
  }, []);

  return (
    <div
      className={cn("relative", className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <div
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 rounded-[inherit] z-[1] transition-opacity duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]"
      />
      {children}
    </div>
  );
}
