import { useMonitorTabStore } from "@/stores/monitorTabStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { MonitorTabBar } from "./MonitorTabBar";
import { PacketMonitorView } from "../PacketMonitorView";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

export function MonitorTabsWrapper() {
  const tabs = useMonitorTabStore((s) => s.tabs);
  const activeTabId = useMonitorTabStore((s) => s.activeTabId);
  const closeTab = useMonitorTabStore((s) => s.closeTab);
  const updateTab = useMonitorTabStore((s) => s.updateTab);
  const storeStopCapture = usePacketCaptureStore((s) => s.stopCapture);

  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null);
  const confirmTab = confirmCloseTabId ? tabs.find((t) => t.id === confirmCloseTabId) : null;

  const handleCloseTab = useCallback((tabId: string) => {
    const tab = useMonitorTabStore.getState().tabs.find((t) => t.id === tabId);
    if (tab?.isCapturing && tab.sessionId) {
      setConfirmCloseTabId(tabId);
    } else {
      closeTab(tabId);
    }
  }, [closeTab]);

  const handleConfirmClose = useCallback(async () => {
    if (!confirmTab) return;
    if (confirmTab.sessionId && confirmTab.isCapturing) {
      try { await storeStopCapture(confirmTab.sessionId); } catch { /* best effort */ }
      updateTab(confirmTab.id, { isCapturing: false });
    }
    closeTab(confirmTab.id);
    setConfirmCloseTabId(null);
  }, [confirmTab, closeTab, storeStopCapture, updateTab]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
      <MonitorTabBar onCloseTab={handleCloseTab} />

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0 px-2 pb-2 pt-1 transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
              tab.id === activeTabId
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-1 pointer-events-none"
            )}
          >
            <PacketMonitorView
              tabId={tab.id}
              executionContext={tab.executionContext}
              isActiveTab={tab.id === activeTabId}
              onCloseTab={() => handleCloseTab(tab.id)}
            />
          </div>
        ))}
      </div>

      {confirmTab && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirmCloseTabId(null)}
          title="Close capturing tab?"
          description={`"${confirmTab.label}" is still capturing. Stop the capture and close this tab?`}
          confirmText="Stop & Close"
          variant="destructive"
          onConfirm={handleConfirmClose}
        />
      )}
    </div>
  );
}
