import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton rounded-md", className)}
      {...props}
    />
  );
}

function TableSkeleton({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton
            key={`h-${i}`}
            className="h-3"
            style={{ width: `${60 + Math.random() * 60}px` }}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex items-center gap-4">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton
              key={`${rowIdx}-${colIdx}`}
              className="h-3.5"
              style={{
                width: `${50 + Math.random() * 80}px`,
                animationDelay: `${(rowIdx * columns + colIdx) * 50}ms`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/50 bg-card/40 p-4 space-y-3",
        className,
      )}
    >
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" style={{ animationDelay: "var(--motion-duration-micro)" }} />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-7 w-16" style={{ animationDelay: "var(--motion-duration-navigation)" }} />
        <Skeleton className="h-7 w-16" style={{ animationDelay: "var(--motion-duration-overlay)" }} />
      </div>
    </div>
  );
}

function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/50 bg-card/40 p-4 flex flex-col items-center gap-2",
        className,
      )}
    >
      <Skeleton className="h-8 w-12" />
      <Skeleton className="h-2.5 w-16" style={{ animationDelay: "var(--motion-duration-micro)" }} />
    </div>
  );
}

export { Skeleton, TableSkeleton, CardSkeleton, StatCardSkeleton };
