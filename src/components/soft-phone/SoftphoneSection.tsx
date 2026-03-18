import type { IconComponent } from "@/lib/icons";
import { cn } from "@/lib/utils";

interface SoftphoneSectionProps {
  title: string;
  icon?: IconComponent;
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function SoftphoneSection({ title, icon: Icon, children, className, compact }: SoftphoneSectionProps) {
  return (
    <section 
      className={cn(
        "ui-panel-shell",
        compact ? "p-3" : "p-4",
        className
      )}
    >
      <div 
        className={cn(
          "flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide",
          compact ? "mb-2" : "mb-3"
        )}
      >
        {Icon && (
          <div className="h-6 w-6 rounded-lg bg-muted/50 flex items-center justify-center">
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
        <span>{title}</span>
      </div>
      <div className={compact ? "space-y-2" : "space-y-3"}>
        {children}
      </div>
    </section>
  );
}
