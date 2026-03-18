import { useMemo, type ComponentType, type SVGProps } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { Activity, Eye, PhoneCall, Printer } from "@/lib/icons";
import { navigateTo } from "@/lib/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

function pluralize(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

type CheckRow = {
  key: string;
  label: string;
  status: string;
  actionLabel: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  onAction: () => void;
};

export function ActiveChecksPanel() {
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const runningSessionIds = usePacketCaptureStore((s) => s.runningSessionIds);
  const calls = useSoftphoneStore((s) => s.calls);
  const sentFaxJobs = useTroubleshootingStore((s) => s.sentFaxJobs);
  const monitorRunning = useNetworkTestStore((s) => s.monitorRunning);
  const voipRunning = useNetworkTestStore((s) => s.voipRunning);
  const bulkRunning = useNetworkTestStore((s) => s.bulkRunning);
  const routeComparing = useNetworkTestStore((s) => s.routeComparing);
  const speedRunning = useNetworkTestStore((s) => s.speedTest.status === "running");

  const runningCaptureCount = useMemo(
    () =>
      sessions.filter((session) => {
        const status = String(session.status).toLowerCase();
        return runningSessionIds.includes(session.id) || status === "running";
      }).length,
    [runningSessionIds, sessions],
  );

  const activeCallCount = useMemo(
    () =>
      calls.filter(
        (call) =>
          call.state === "connecting" ||
          call.state === "ringing" ||
          call.state === "active" ||
          call.state === "on-hold",
      ).length,
    [calls],
  );

  const activeFaxCount = useMemo(
    () => sentFaxJobs.filter((job) => job.status === "pending" || job.status === "sending").length,
    [sentFaxJobs],
  );

  const activeNetworkChecks = useMemo(
    () =>
      Number(monitorRunning) +
      Number(voipRunning) +
      Number(bulkRunning) +
      Number(routeComparing) +
      Number(speedRunning),
    [bulkRunning, monitorRunning, routeComparing, speedRunning, voipRunning],
  );

  const rows: CheckRow[] = useMemo(() => {
    const result: CheckRow[] = [];
    if (runningCaptureCount > 0) {
      result.push({
        key: "captures",
        label: "Packet Capture",
        status: `${runningCaptureCount} ${pluralize(runningCaptureCount, "session", "sessions")} running`,
        actionLabel: "Open",
        icon: Eye,
        onAction: () => navigateTo("packet-capture", "monitor"),
      });
    }
    if (activeCallCount > 0) {
      result.push({
        key: "calls",
        label: "Calls",
        status: `${activeCallCount} ${pluralize(activeCallCount, "call", "calls")} active`,
        actionLabel: "Open",
        icon: PhoneCall,
        onAction: () => navigateTo("soft-phone"),
      });
    }
    if (activeFaxCount > 0) {
      result.push({
        key: "fax",
        label: "Fax Jobs",
        status: `${activeFaxCount} ${pluralize(activeFaxCount, "job", "jobs")} in progress`,
        actionLabel: "Open",
        icon: Printer,
        onAction: () => navigateTo("fax-center", "faxes"),
      });
    }
    if (activeNetworkChecks > 0) {
      result.push({
        key: "network-tests",
        label: "Network Tests",
        status: `${activeNetworkChecks} active checks`,
        actionLabel: "Open",
        icon: Activity,
        onAction: () => navigateTo("network", "path-performance"),
      });
    }
    return result;
  }, [activeCallCount, activeFaxCount, activeNetworkChecks, runningCaptureCount]);

  return (
    <div className="ui-panel-shell flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.96)_0%,hsl(var(--card)/0.88)_100%)]">
      <div className="flex items-center justify-between border-b border-border/45 px-3 py-2">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-primary/75" />
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.13em] text-foreground/90">
            Active Checks
          </h2>
        </div>
        {rows.length > 0 && (
          <span className="rounded-sm border border-success/35 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-success">
            {rows.length}
          </span>
        )}
      </div>

      {rows.length > 0 ? (
        <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <div
                key={row.key}
                className="flex items-center gap-2.5 rounded-sm border border-border/35 bg-background/30 px-2.5 py-2"
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-border/45 bg-black/20">
                  <Icon className="h-3.5 w-3.5 text-foreground/80" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium leading-tight text-foreground/90">{row.label}</p>
                  <p className="truncate text-[10px] leading-tight text-muted-foreground/80">{row.status}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-2xs text-foreground/80"
                  onClick={row.onAction}
                >
                  {row.actionLabel}
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 p-2.5">
          <EmptyState
            compact
            variant="inline"
            icon={<Activity />}
            title="No active checks"
            description="Captures, calls, fax jobs, and network tests show up here when running."
            className="h-full rounded-sm border border-border/40 bg-background/20 px-3"
          />
        </div>
      )}
    </div>
  );
}
