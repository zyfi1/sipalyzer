/**
 * Syncs softphone, registration, and packet capture state into the central troubleshooting store.
 * Call once at app root (e.g. AppContent) so all views get a single source of truth.
 *
 * Flow:
 * - On mount: refresh() registration health, then syncFromStores with current payload.
 * - On any source store change: syncFromStores (debounced) with merged payload from all sources.
 *
 * Data source registry: add a new entry to SYNC_SOURCES to plug in a new domain (e.g. alarms).
 * Extend TroubleshootingSyncPayload and syncFromStores in the store to consume new fields.
 */

import { useEffect, useRef } from "react";
import {
  useTroubleshootingStore,
  type TroubleshootingSyncPayload,
} from "@/stores/troubleshootingStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useToolVisible } from "@/hooks/useToolVisible";

const SYNC_DEBOUNCE_MS = 100;

function mergePayloads(): TroubleshootingSyncPayload {
  const merged: TroubleshootingSyncPayload = {
    calls: useSoftphoneStore.getState().calls,
    registrars: useRegistrationStore
      .getState()
      .registrars
      .map((r) => ({
        id: r.id,
        name: r.name,
        username: r.username,
        domain: r.domain,
        transport: r.transport,
        remote_port: r.remote_port,
      })),
    sessions: usePacketCaptureStore.getState().sessions,
  };
  return merged;
}

function useTroubleshootingSync() {
  const refresh = useTroubleshootingStore((s) => s.refresh);
  const fetchRegistrars = useRegistrationStore((s) => s.fetchRegistrars);
  const syncFromStores = useTroubleshootingStore((s) => s.syncFromStores);
  const isVisible = useToolVisible("troubleshooting");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const initialRefreshDone = useRef(false);

  const runSync = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (cancelledRef.current) return;
      syncFromStores(mergePayloads());
    }, SYNC_DEBOUNCE_MS);
  };

  // Always refresh registration health on mount — softphone and fax areas need it
  // regardless of whether the troubleshooting tool is visible.
  useEffect(() => {
    if (initialRefreshDone.current) return;
    initialRefreshDone.current = true;
    // Defer so we don't block the initial render
    const id = setTimeout(() => {
      (async () => {
        await Promise.allSettled([
          fetchRegistrars(),
          refresh(),
        ]);
        runSync();
      })();
    }, 50);
    return () => clearTimeout(id);
  }, [fetchRegistrars, refresh]);

  // When the troubleshooting tool becomes visible, do a full refresh + sync
  useEffect(() => {
    if (!isVisible) return;
    cancelledRef.current = false;

    // Defer the async refresh to the next idle frame so the view renders instantly
    const idleId =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(() => {
            if (cancelledRef.current) return;
            (async () => {
              await Promise.allSettled([
                fetchRegistrars(),
                refresh(),
              ]);
              if (!cancelledRef.current) runSync();
            })();
          })
        : undefined;

    // Fallback for environments without requestIdleCallback
    const timeoutId =
      idleId === undefined
        ? setTimeout(() => {
            if (cancelledRef.current) return;
            (async () => {
              await Promise.allSettled([
                fetchRegistrars(),
                refresh(),
              ]);
              if (!cancelledRef.current) runSync();
            })();
          }, 50)
        : undefined;

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (idleId !== undefined && typeof cancelIdleCallback === "function") cancelIdleCallback(idleId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [fetchRegistrars, refresh, isVisible]);

  // Always subscribe to registration store changes for health updates.
  // Timeline/findings sync is still gated by visibility.
  useEffect(() => {
    // Registration changes always trigger a health refresh (for softphone/fax areas)
    const unsubRegistration = useRegistrationStore.subscribe((state, prev) => {
      if (state.testResults !== prev.testResults) {
        // Health is already refreshed by registrationStore's refreshHealthAfterRegistration(),
        // but also trigger a sync if the troubleshooting view is visible
        if (useTroubleshootingStore.getState().registrationHealth) {
          runSync();
        }
      }
    });
    return () => unsubRegistration();
  }, [syncFromStores]);

  // Subscribe to only relevant source slices for timeline/findings sync when visible
  useEffect(() => {
    if (!isVisible) return;
    const unsubSoftphone = useSoftphoneStore.subscribe((state, prev) => {
      if (state.calls !== prev.calls) runSync();
    });
    const unsubRegistration = useRegistrationStore.subscribe((state, prev) => {
      if (state.registrars !== prev.registrars) runSync();
    });
    const unsubPacketCapture = usePacketCaptureStore.subscribe((state, prev) => {
      if (state.sessions !== prev.sessions) runSync();
    });
    return () => {
      unsubSoftphone();
      unsubRegistration();
      unsubPacketCapture();
    };
  }, [syncFromStores, isVisible]);
}

export function useTroubleshootingSyncMount() {
  useTroubleshootingSync();
}
