import { useNetworkTestStore } from "@/stores/networkTestStore";
import { Gauge, Loader2, ArrowDownToLine, ArrowUpFromLine } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const MAX_SPEED = 500;

export function LastSpeedTestSection() {
  const speedTest = useNetworkTestStore((s) => s.speedTest);
  const speedTestCachedAt = useNetworkTestStore((s) => s.speedTestCachedAt);
  const runSpeedTest = useNetworkTestStore((s) => s.runSpeedTest);

  const isRunning = speedTest.status === "running";
  const result = speedTest.result;

  return (
    <div className="surface p-5 flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground/60" />
          <h2 className="text-sm font-semibold text-foreground/70">Speed Test</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-2xs text-muted-foreground/50 hover:text-foreground/70 gap-1"
          onClick={() => runSpeedTest(true)}
          disabled={isRunning}
        >
          {isRunning ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : result ? (
            "Run Again"
          ) : (
            "Run Test"
          )}
        </Button>
      </div>

      {isRunning ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6">
          <Loader2 className="h-6 w-6 text-muted-foreground/30 animate-spin mb-2" />
          <p className="text-xs text-muted-foreground/40">Running speed test…</p>
        </div>
      ) : result ? (
        <div className="space-y-3 overflow-y-auto flex-1 min-h-0 -mx-2 px-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-muted-foreground/50">
                <ArrowDownToLine className="h-3 w-3" />
                <span className="text-3xs uppercase tracking-wider">Download</span>
              </div>
              <p className="text-xl font-bold text-foreground/80 tabular-nums leading-tight">
                {result.download_mbps.toFixed(1)}
                <span className="text-xs font-normal text-muted-foreground/50 ml-1">Mbps</span>
              </p>
              <div className="h-1 rounded-full bg-muted/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-success transition-all"
                  style={{ width: `${Math.min((result.download_mbps / MAX_SPEED) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-muted-foreground/50">
                <ArrowUpFromLine className="h-3 w-3" />
                <span className="text-3xs uppercase tracking-wider">Upload</span>
              </div>
              <p className="text-xl font-bold text-foreground/80 tabular-nums leading-tight">
                {result.upload_mbps.toFixed(1)}
                <span className="text-xs font-normal text-muted-foreground/50 ml-1">Mbps</span>
              </p>
              <div className="h-1 rounded-full bg-muted/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min((result.upload_mbps / MAX_SPEED) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex gap-4 text-3xs text-muted-foreground/50">
            <span className="tabular-nums">Latency: {result.latency_ms.toFixed(1)} ms</span>
            <span className="tabular-nums">Jitter: {result.jitter_ms.toFixed(1)} ms</span>
          </div>

          {result.server && (
            <p className="text-3xs text-muted-foreground/30 truncate">{result.server}</p>
          )}

          {speedTestCachedAt && (
            <p className="text-3xs text-muted-foreground/30">
              Tested {relativeTime(speedTestCachedAt)}
            </p>
          )}
        </div>
      ) : (
        <EmptyState
          compact
          variant="inline"
          icon={<Gauge />}
          title="No speed test results"
          className="py-6"
        />
      )}
    </div>
  );
}
