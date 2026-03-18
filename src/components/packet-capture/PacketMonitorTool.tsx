/**
 * PacketMonitorTool — Standalone tool for the live packet monitor.
 *
 * Supports multiple simultaneous capture tabs (local + remote agents).
 * Each tab runs an independent PacketMonitorView instance.
 *
 * The execution context selector is integrated into the MonitorTabBar,
 * sitting inline with the tab strip for a cleaner layout.
 */

import { useEffect, lazy, Suspense } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useToolVisible } from "@/hooks/useToolVisible";

const MonitorTabsWrapper = lazy(() =>
  import("./monitor/MonitorTabsWrapper").then((m) => ({ default: m.MonitorTabsWrapper }))
);

export function PacketMonitorTool() {
  const fetchInterfaces = usePacketCaptureStore((s) => s.fetchInterfaces);
  const isVisible = useToolVisible("packet-capture");

  useEffect(() => {
    if (!isVisible) return;
    const schedule = () => {
      if (typeof requestIdleCallback !== "undefined") {
        const id = requestIdleCallback(() => fetchInterfaces(), { timeout: 200 });
        return () => cancelIdleCallback(id);
      }
      const t = setTimeout(fetchInterfaces, 100);
      return () => clearTimeout(t);
    };
    const cancel = schedule();
    return () => cancel?.();
  }, [fetchInterfaces, isVisible]);

  return (
    <div className="surface-subtle flex h-full flex-col overflow-hidden rounded-lg">
      <div className="ui-panel-shell flex-1 min-h-0 overflow-hidden rounded-lg">
        <Suspense
          fallback={
            <div className="flex min-h-[300px] flex-1 items-center justify-center text-sm text-muted-foreground">
              Loading monitor…
            </div>
          }
        >
          <MonitorTabsWrapper />
        </Suspense>
      </div>
    </div>
  );
}
