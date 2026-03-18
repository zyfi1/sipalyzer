/**
 * Keeps network state in sync with the actual network.
 * Call once in the app (e.g. App.tsx) to:
 * - Poll interfaces periodically (using getState() so no stale closure)
 * - Refetch on window focus and tab visibility (user returns / just connected)
 * - Refetch when browser goes online
 * - Trigger packet capture interface refresh when localIp changes
 */

import { useEffect, useRef } from "react";
import { useNetworkStore } from "@/stores/networkStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";

const POLL_INTERVAL_MS = 8000;
const INITIAL_REFRESH_DELAY_MS = 300;

function doRefresh() {
  useNetworkStore.getState().refresh();
}

export function useNetworkSync(): void {
  const localIp = useNetworkStore((s) => s.localIp);
  const prevLocalIpRef = useRef<string | null>(null);
  const fetchInterfaces = usePacketCaptureStore((s) => s.fetchInterfaces);

  useEffect(() => {
    // Delay first refresh so Tauri backend is ready (avoids invoke failing on load)
    const initialTimer = setTimeout(doRefresh, INITIAL_REFRESH_DELAY_MS);

    const interval = setInterval(doRefresh, POLL_INTERVAL_MS);

    const onFocus = () => doRefresh();
    const onOnline = () => doRefresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") doRefresh();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // When local IP changes (e.g. user switched WiFi/VPN), refresh packet capture interfaces
  useEffect(() => {
    if (prevLocalIpRef.current !== localIp) {
      prevLocalIpRef.current = localIp;
      if (localIp != null) {
        fetchInterfaces();
      }
    }
  }, [localIp, fetchInterfaces]);
}
