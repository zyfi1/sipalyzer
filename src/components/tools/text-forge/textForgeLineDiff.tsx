import { cn } from "@/lib/utils";

export type LineDiffRow = { kind: "same" | "add" | "remove"; line: string };

const MAX_DIFF_CELLS = 1_200_000;

/**
 * Myers-style LCS reconstruction on lines (O(mn) memory). Skipped when too large.
 */
export function computeLineDiff(before: string, after: string): LineDiffRow[] | null {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const m = a.length;
  const n = b.length;
  if (m * n > MAX_DIFF_CELLS) return null;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i]![j]! = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j]! = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const out: LineDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      out.push({ kind: "same", line: a[i]! });
      i++;
      j++;
    } else if (j < n && (i === m || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      out.push({ kind: "add", line: b[j]! });
      j++;
    } else if (i < m) {
      out.push({ kind: "remove", line: a[i]! });
      i++;
    }
  }
  return out;
}

export function TextForgeDiffScroll({
  before,
  after,
  className,
}: {
  before: string;
  after: string;
  className?: string;
}) {
  const rows = computeLineDiff(before, after);
  if (rows === null) {
    return (
      <div className={cn("rounded-md border border-border/30 bg-muted/10 p-3 text-2xs text-muted-foreground", className)}>
        Diff is disabled for this payload size (too many lines). Use smaller samples or disable Diff.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-auto rounded-md border border-border/30 bg-background/40 font-mono text-xs leading-5",
        className,
      )}
      role="region"
      aria-label="Line diff"
    >
      <div className="min-w-max p-2 space-y-px">
        {rows.map((row, idx) => (
          <div
            key={`${idx}-${row.kind}-${row.line.slice(0, 24)}`}
            className={cn(
              "flex gap-2 px-1.5 py-0.5 rounded-sm",
              row.kind === "same" && "text-foreground/90",
              row.kind === "add" && "bg-primary/10 text-foreground border-l-2 border-primary/45",
              row.kind === "remove" && "bg-destructive/10 text-foreground border-l-2 border-destructive/45",
            )}
          >
            <span className="w-4 shrink-0 select-none text-muted-foreground/80" aria-hidden>
              {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}
            </span>
            <span className="whitespace-pre-wrap break-all">{row.line || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
