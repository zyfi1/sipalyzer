import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@/lib/tauriEvents";
import { ToastProvider } from "./contexts/ToastContext";
import { Toaster } from "./components/ui/sonner";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { ToolContainer } from "./components/layout/ToolContainer";
import { LoadScreen, MIN_LOAD_DISPLAY_MS } from "./components/layout/LoadScreen";
import { LoadingOverlay } from "./components/ui/loading-overlay";
import { TopographicBackground } from "./components/layout/TopographicBackground";
import { preloadAllTools, TOOL_PRELOAD_COUNT } from "./lib/preloadTools";
import { useNotificationStore } from "./stores/notificationStore";
import { useLayoutStore } from "./stores/layoutStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useSoftphoneStore } from "./stores/softphoneStore";
import { useContextMenuStore } from "./stores/contextMenuStore";
import { useTroubleshootingStore } from "./stores/troubleshootingStore";
import { useToolStore } from "./stores/toolStore";
import { useSidebarStore } from "./stores/sidebarStore";
import { useContactsStore } from "./stores/contactsStore";
import { useRegistrationStore } from "./stores/registrationStore";
import { useSshStore } from "./stores/sshStore";
import { usePacketAnnotationStore } from "./stores/packetAnnotationStore";
import { useNetworkTestStore } from "./stores/networkTestStore";
import { useUiPrefsStore } from "./stores/uiPrefsStore";
import { useCrafterStore } from "./stores/crafterStore";
import { useComposerStore } from "./stores/composerStore";
import { useSipDiscoveryStore } from "./stores/sipDiscoveryStore";
import { useRemoteAgentStore } from "./stores/remoteAgentStore";
import { usePacketCaptureStore } from "./stores/packetCaptureStore";
import { useTtsStore } from "./stores/ttsStore";
import { useHomeStore } from "./stores/homeStore";
import { useNetworkDevicesStore } from "./stores/networkDevicesStore";
import { useGlobalFileDropStore } from "./stores/globalFileDropStore";
import { useRemoteChatStore } from "./stores/remoteChatStore";
import { useMcpStore } from "./stores/mcpStore";
import { useIncomingFaxStore } from "./stores/incomingFaxStore";
import { useUpdaterStore } from "./stores/updaterStore";
import { RemoteChatWindow } from "./components/remote-agent/RemoteChatWindow";
import type { RemoteChatMessage, RemoteChatState } from "./api/remoteAgent";

import { getRemoteEndedCalls, stopInboundListener, syncInboundListeners } from "./lib/softphone";
import { initHashSync, navigateTo } from "./lib/navigation";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invokeTauri } from "./api/invoke";
import { importPcapFromBase64, importPcapFromPath } from "./api/packetCapture";
import {
  loadSessionState,
  applyStateToStores,
  saveSessionState,
  collectStateFromStores,
  collectStateSlicesFromStores,
  mergeSessionState,
  type PersistedSessionSlice,
} from "./lib/sessionState";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShortcutsPanel } from "./components/shortcuts/ShortcutsPanel";
import { GlobalContextMenu } from "./components/context-menu";
import { TooltipProvider } from "./components/ui/tooltip";
import { ConfirmDialog } from "./components/ui/confirm-dialog";
import { useNetworkSync } from "./hooks/useNetworkSync";
import { useFeatureFlag } from "./hooks/useFeatureFlag";
import { FEATURE_FLAG_KNOWLEDGE_BASE_UI } from "./lib/featureFlags";
import { listFeatureFlags } from "./api/admin";
import { setCachedFeatureFlag } from "./lib/featureFlagCache";
import { useShallow } from "zustand/react/shallow";
import { useOpenCaptureStore } from "./hooks/useOpenCapture";
import { onMcpAgentProgress, onMcpServerStatus } from "./api/mcp";
import styles from "./App.module.css";

const NotesCenter = lazy(() =>
  import("./components/notes/NotesCenter").then((m) => ({ default: m.NotesCenter }))
);
const KnowledgeBaseCenter = lazy(() =>
  import("./components/troubleshooting/KnowledgeBaseCenter").then((m) => ({ default: m.KnowledgeBaseCenter }))
);
let settingsCenterPreloadPromise: Promise<typeof import("./components/settings/SettingsCenter")> | null = null;
const preloadSettingsCenter = () => {
  settingsCenterPreloadPromise ??= import("./components/settings/SettingsCenter");
  return settingsCenterPreloadPromise;
};
const SettingsCenter = lazy(() =>
  preloadSettingsCenter().then((m) => ({ default: m.SettingsCenter }))
);
const FloatingTerminal = lazy(() =>
  import("./components/terminal/FloatingTerminal").then((m) => ({ default: m.FloatingTerminal }))
);
const GlobalSearchDialog = lazy(() =>
  import("./components/search/GlobalSearchDialog").then((m) => ({ default: m.GlobalSearchDialog }))
);
const NotificationsCenter = lazy(() =>
  import("./components/notifications/NotificationsCenter").then((m) => ({ default: m.NotificationsCenter }))
);
const GlobalPacketViewerModal = lazy(() => import("./components/packet-capture/GlobalPacketViewerModal"));

function isRemoteChatWindow(): boolean {
  try {
    return getCurrentWindow().label === "remote-chat";
  } catch {
    return false;
  }
}
const CAPTURE_FILE_RE = /\.(pcap|pcapng|cap)$/i;
const FAX_FILE_RE = /\.(pdf|png|jpg|jpeg|tif|tiff)$/i;
const MAX_BOOT_WAIT_MS = 8000;
const DEV_BOOT_BYPASS =
  Boolean(import.meta.env.DEV) ||
  (typeof window !== "undefined" && window.location.port === "1420");

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function guessMimeTypeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  return "application/octet-stream";
}

function AppContent() {
  const [toolsReady, setToolsReady] = useState(DEV_BOOT_BYPASS);
  const [settingsCenterReady, setSettingsCenterReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number }>({
    loaded: DEV_BOOT_BYPASS ? TOOL_PRELOAD_COUNT : 0,
    total: TOOL_PRELOAD_COUNT,
  });
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const loadStartRef = useRef<number | null>(null);
  const hashSyncInitialized = useRef(false);
  const hashSyncCleanupRef = useRef<(() => void) | null>(null);
  const sessionStateLoaded = useRef(false);
  const latestPersistedStateRef = useRef<ReturnType<typeof collectStateFromStores> | null>(null);
  const dirtySlicesRef = useRef<Set<PersistedSessionSlice>>(new Set());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  /** Unsubscribe functions for store save-subscriptions, set once session state is loaded. */
  const saveUnsubs = useRef<Array<() => void>>([]);
  const settings = useNotificationStore((s) => s.settings);
  const highVisibility = useSettingsStore((s) => s.highVisibility);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const updatePrefs = useSettingsStore((s) => s.updates);
  const availableUpdate = useUpdaterStore((s) => s.availableUpdate);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const layout = useLayoutStore(
    useShallow((s) => ({
      notesCenterOpen: s.notesCenterOpen,
      notificationsCenterOpen: s.notificationsCenterOpen,
      settingsCenterOpen: s.settingsCenterOpen,
      kbCenterOpen: s.kbCenterOpen,
      searchOpen: s.searchOpen,
      shortcutsPanelOpen: s.shortcutsPanelOpen,
      terminalOpen: s.terminalOpen,
      terminalMinimized: s.terminalMinimized,
      reloadCounter: s.reloadCounter,
      setNotesCenterOpen: s.setNotesCenterOpen,
      setNotificationsCenterOpen: s.setNotificationsCenterOpen,
      setSettingsCenterOpen: s.setSettingsCenterOpen,
      setKbCenterOpen: s.setKbCenterOpen,
      setShortcutsPanelOpen: s.setShortcutsPanelOpen,
      setTerminalMinimized: s.setTerminalMinimized,
      setTerminalOpen: s.setTerminalOpen,
    }))
  );
  const packetViewerSessionId = useOpenCaptureStore((s) => s.modalSessionId);
  const activeRegistrarId = useSoftphoneStore((s) => s.activeRegistrarId);
  const setInboundListenerStatus = useSoftphoneStore((s) => s.setInboundListenerStatus);
  const registrars = useRegistrationStore((s) => s.registrars);
  const { enabled: knowledgeBaseEnabled } = useFeatureFlag(FEATURE_FLAG_KNOWLEDGE_BASE_UI);
  const featureFlagHydrationQuery = useQuery({
    queryKey: ["feature-flags", "hydrate-cache"],
    queryFn: listFeatureFlags,
  });

  // Hydrate feature-flag cache on app boot so non-hook surfaces
  // (sidebar/context menu/palette helpers) can gate visibility correctly.
  useEffect(() => {
    for (const flag of featureFlagHydrationQuery.data ?? []) {
      setCachedFeatureFlag(flag.key, flag.enabled);
    }
  }, [featureFlagHydrationQuery.data]);

  useEffect(() => {
    if (!knowledgeBaseEnabled && layout.kbCenterOpen) {
      layout.setKbCenterOpen(false);
    }
  }, [knowledgeBaseEnabled, layout.kbCenterOpen, layout.setKbCenterOpen]);

  // Preload settings early and keep it mounted (hidden when closed) so open is instant.
  useEffect(() => {
    let cancelled = false;
    const warm = async () => {
      try {
        await preloadSettingsCenter();
        if (!cancelled) setSettingsCenterReady(true);
      } catch {
        // Keep UI usable even if warmup fails; first open will retry through lazy import.
      }
    };
    const timeout = window.setTimeout(() => {
      void warm();
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  // Master load: load all tool chunks with progress; show load screen for at least MIN_LOAD_DISPLAY_MS
  useEffect(() => {
    if (DEV_BOOT_BYPASS) {
      setLoadProgress({ loaded: TOOL_PRELOAD_COUNT, total: TOOL_PRELOAD_COUNT });
      setToolsReady(true);
      return;
    }
    let cancelled = false;
    let minDelayTimer: ReturnType<typeof setTimeout> | null = null;
    const forceReadyTimer = window.setTimeout(() => {
      if (cancelled) return;
      setLoadProgress((p) => ({ loaded: Math.max(p.loaded, p.total), total: p.total }));
      setToolsReady(true);
    }, MAX_BOOT_WAIT_MS);

    loadStartRef.current = Date.now();
    preloadAllTools((loaded, total) => setLoadProgress({ loaded, total }))
      .then(() => {
        if (cancelled) return;
        window.clearTimeout(forceReadyTimer);
        const elapsed = Date.now() - (loadStartRef.current ?? 0);
        const remaining = MIN_LOAD_DISPLAY_MS - elapsed;
        if (remaining <= 0) {
          setToolsReady(true);
        } else {
          minDelayTimer = setTimeout(() => {
            if (!cancelled) setToolsReady(true);
          }, remaining);
        }
      })
      .catch(() => {
        if (cancelled) return;
        window.clearTimeout(forceReadyTimer);
        // Fail-open: never leave the user stranded on the loading screen.
        setToolsReady(true);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(forceReadyTimer);
      if (minDelayTimer != null) window.clearTimeout(minDelayTimer);
    };
  }, []);

  // Force-reload UI: triggered via ⌘⇧R shortcut (reloadCounter bumps)
  const prevReloadRef = useRef(layout.reloadCounter);
  useEffect(() => {
    if (DEV_BOOT_BYPASS) {
      prevReloadRef.current = layout.reloadCounter;
      return;
    }
    if (layout.reloadCounter === prevReloadRef.current) return; // skip initial
    let cancelled = false;
    let minDelayTimer: ReturnType<typeof setTimeout> | null = null;
    const forceReadyTimer = window.setTimeout(() => {
      if (cancelled) return;
      setLoadProgress((p) => ({ loaded: Math.max(p.loaded, p.total), total: p.total }));
      setToolsReady(true);
    }, MAX_BOOT_WAIT_MS);

    prevReloadRef.current = layout.reloadCounter;
    // Reset to loading state
    setToolsReady(false);
    setLoadProgress({ loaded: 0, total: TOOL_PRELOAD_COUNT });
    // Re-preload all tools with fresh load screen
    loadStartRef.current = Date.now();
    preloadAllTools((loaded, total) => setLoadProgress({ loaded, total }))
      .then(() => {
        if (cancelled) return;
        window.clearTimeout(forceReadyTimer);
        const elapsed = Date.now() - (loadStartRef.current ?? 0);
        const remaining = MIN_LOAD_DISPLAY_MS - elapsed;
        if (remaining <= 0) {
          setToolsReady(true);
        } else {
          minDelayTimer = setTimeout(() => {
            if (!cancelled) setToolsReady(true);
          }, remaining);
        }
      })
      .catch(() => {
        if (cancelled) return;
        window.clearTimeout(forceReadyTimer);
        // Fail-open on manual reload as well.
        setToolsReady(true);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(forceReadyTimer);
      if (minDelayTimer != null) window.clearTimeout(minDelayTimer);
    };
  }, [layout.reloadCounter]);

  useNetworkSync();
  useAppShortcuts();

  // Load session state from DB, apply to stores, then set up save subscriptions.
  // Subscriptions are created *inside* the load callback so they only activate
  // after persisted data has been applied (prevents overwriting with defaults).
  useEffect(() => {
    let cancelled = false;
    if (toolsReady && !hashSyncInitialized.current) {
      hashSyncInitialized.current = true;
      loadSessionState().then((state) => {
        if (cancelled) return;
        applyStateToStores(state);
        latestPersistedStateRef.current = state;
        sessionStateLoaded.current = true;
        // Restore controller->relay sessions for previously deployed agents so
        // running agents can reconnect after app restart/crash.
        useRemoteAgentStore.getState().restoreRelaySessions().catch(() => {});
        hashSyncCleanupRef.current = initHashSync();

        const flushDirtySlices = () => {
          if (!sessionStateLoaded.current || dirtySlicesRef.current.size === 0) return;
          if (saveInFlightRef.current) return;
          const dirtySlices = Array.from(dirtySlicesRef.current);
          dirtySlicesRef.current.clear();

          const saveTask = async () => {
            const patch = collectStateSlicesFromStores(dirtySlices);
            const base = latestPersistedStateRef.current ?? collectStateFromStores();
            const merged = mergeSessionState(base, patch);
            await saveSessionState(merged);
            latestPersistedStateRef.current = merged;
          };

          saveInFlightRef.current = saveTask().catch(() => {}).finally(() => {
            saveInFlightRef.current = null;
          });
        };

        // --- Debounced dirty-slice save on persisted-store changes ---
        const DEBOUNCE_MS = 1000;
        const scheduleSave = (slice: PersistedSessionSlice) => {
          dirtySlicesRef.current.add(slice);
          // Throttle-style scheduling: once a save is queued, keep that deadline.
          // This prevents continuous updates (like SIP logs/transcript events)
          // from postponing persistence indefinitely.
          if (saveTimeoutRef.current != null) return;
          saveTimeoutRef.current = setTimeout(() => {
            saveTimeoutRef.current = null;
            flushDirtySlices();
          }, DEBOUNCE_MS);
        };

        const forceFlushDirtySlices = () => {
          if (saveTimeoutRef.current != null) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
          }
          flushDirtySlices();
        };

        // Safety net: force periodic flush so call history is written even during
        // steady, high-frequency softphone updates.
        const autosaveInterval = window.setInterval(() => {
          forceFlushDirtySlices();
        }, 3000);

        const handleVisibilityChange = () => {
          if (document.visibilityState === "hidden") {
            forceFlushDirtySlices();
          }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("pagehide", forceFlushDirtySlices);

        // Load TTS voices now that the WebView is ready
        useTtsStore.getState().loadVoices();

        saveUnsubs.current = [
          useToolStore.subscribe(() => scheduleSave("tool")),
          useSidebarStore.subscribe(() => scheduleSave("sidebar")),
          useNotificationStore.subscribe(() => scheduleSave("notification")),
          useTroubleshootingStore.subscribe(() => scheduleSave("troubleshooting")),
          useSettingsStore.subscribe(() => scheduleSave("settings")),
          useSoftphoneStore.subscribe(() => scheduleSave("softphone")),
          useContactsStore.subscribe(() => scheduleSave("contacts")),
          useSshStore.subscribe(() => scheduleSave("ssh")),
          usePacketAnnotationStore.subscribe(() => scheduleSave("packetAnnotations")),
          useNetworkTestStore.subscribe(() => scheduleSave("networkTest")),
          useUiPrefsStore.subscribe(() => scheduleSave("uiPrefs")),
          useCrafterStore.subscribe(() => scheduleSave("crafter")),
          useComposerStore.subscribe(() => scheduleSave("composer")),
          useSipDiscoveryStore.subscribe(() => scheduleSave("sipDiscovery")),
          useNetworkDevicesStore.subscribe(() => scheduleSave("networkDevices")),
          useRemoteAgentStore.subscribe(() => scheduleSave("remoteAgent")),
          useTtsStore.subscribe(() => scheduleSave("tts")),
          useHomeStore.subscribe(() => scheduleSave("home")),
          useMcpStore.subscribe(() => scheduleSave("mcp")),
          () => window.clearInterval(autosaveInterval),
          () => document.removeEventListener("visibilitychange", handleVisibilityChange),
          () => window.removeEventListener("pagehide", forceFlushDirtySlices),
        ];
      }).catch(() => {
        if (cancelled) return;
        // Allow a future retry path if boot-time session hydration fails.
        hashSyncInitialized.current = false;
      });
    }
    return () => {
      cancelled = true;
      if (saveTimeoutRef.current != null) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      hashSyncCleanupRef.current?.();
      hashSyncCleanupRef.current = null;
      hashSyncInitialized.current = false;
      saveUnsubs.current.forEach((unsub) => unsub());
      saveUnsubs.current = [];
    };
  }, [toolsReady]);

  // ── Unified shutdown flow ──────────────────────────────────────────
  // Rust always prevents native close and emits events to us.
  // We handle: confirmation dialog, session save, backend cleanup, exit.

  const shutdownInProgress = useRef(false);

  const performShutdown = async () => {
    if (shutdownInProgress.current) return;
    shutdownInProgress.current = true;
    try {
      if (sessionStateLoaded.current) {
        if (saveTimeoutRef.current != null) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        if (dirtySlicesRef.current.size > 0) {
          const dirtySlices = Array.from(dirtySlicesRef.current);
          dirtySlicesRef.current.clear();
          const patch = collectStateSlicesFromStores(dirtySlices);
          const base = latestPersistedStateRef.current ?? collectStateFromStores();
          const merged = mergeSessionState(base, patch);
          await saveSessionState(merged).catch(() => {});
          latestPersistedStateRef.current = merged;
        } else {
          // Ensure we still persist everything on controlled shutdown.
          const full = collectStateFromStores();
          await saveSessionState(full).catch(() => {});
          latestPersistedStateRef.current = full;
        }
        if (saveInFlightRef.current) {
          await saveInFlightRef.current.catch(() => {});
        }
      }
      await invokeTauri("perform_app_cleanup").catch(() => {});
      await invokeTauri("exit_app").catch(() => {});
    } catch {
      // Last resort — force destroy if commands failed
      getCurrentWindow().destroy();
    }
  };

  const requestClose = () => {
    if (shutdownInProgress.current) return;
    const shouldConfirm = useSettingsStore.getState().confirmOnClose;
    if (shouldConfirm) {
      setShowCloseConfirm(true);
      return;
    }
    performShutdown();
  };

  // Rust emits this when the user clicks the window X button (non-tray mode)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("app:close-requested", () => requestClose())
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  // Rust emits this when the user clicks "Quit SIPalyzer" in the tray menu.
  // We show the window first (it may be hidden) so the confirmation dialog is visible.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("app:request-quit", async () => {
      const win = getCurrentWindow();
      await win.show().catch(() => {});
      await win.unminimize().catch(() => {});
      await win.setFocus().catch(() => {});
      requestClose();
    })
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  // App-wide file drop fallback for importable files.
  // Tool-specific drop zones still win: this only runs when drop wasn't handled.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.defaultPrevented) return;
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };

    const onDrop = async (e: DragEvent) => {
      if (e.defaultPrevented) return;
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      if (!dropped.length) return;

      const captureFiles = dropped.filter((f) => CAPTURE_FILE_RE.test(f.name));
      const faxFiles = dropped.filter((f) => FAX_FILE_RE.test(f.name));
      e.preventDefault();

      try {
        if (captureFiles.length > 0) {
          let lastSessionId: string | null = null;
          for (const file of captureFiles) {
            const fp = (file as unknown as { path?: string }).path;
            if (fp) {
              lastSessionId = await importPcapFromPath(fp);
              continue;
            }
            const buffer = await file.arrayBuffer();
            const base64Data = bytesToBase64(new Uint8Array(buffer));
            lastSessionId = await importPcapFromBase64(base64Data, file.name);
          }
          if (!lastSessionId) return;

          useNotificationStore.getState().addNotification({
            source: "packet-capture",
            type: "success",
            title: "Capture Imported",
            description: `${captureFiles[captureFiles.length - 1]?.name ?? "PCAP file"} is ready for analysis.`,
            navigation: { tool: "packet-capture", subview: "analysis" },
          });
          navigateTo("packet-capture", "analysis", { packetCaptureSessionId: lastSessionId });
          return;
        }

        if (faxFiles.length > 0) {
          const droppedFaxFiles = [];
          for (const file of faxFiles) {
            const buffer = await file.arrayBuffer();
            const base64Data = bytesToBase64(new Uint8Array(buffer));
            const mime = file.type || guessMimeTypeFromName(file.name);
            droppedFaxFiles.push({
              name: file.name,
              base64: base64Data,
              dataUrl: `data:${mime};base64,${base64Data}`,
            });
          }
          useGlobalFileDropStore.getState().enqueueFaxFiles(droppedFaxFiles);
          useNotificationStore.getState().addNotification({
            source: "fax-center",
            type: "success",
            title: "Fax Files Ready",
            description: `${droppedFaxFiles.length} file${droppedFaxFiles.length === 1 ? "" : "s"} added to Fax Send.`,
            navigation: { tool: "fax-center", subview: "send" },
          });
          navigateTo("fax-center", "send");
          return;
        }

        useNotificationStore.getState().addNotification({
          source: "system",
          type: "warning",
          title: "Unsupported Drop",
          description: "Supported: .pcap/.pcapng/.cap, .pdf/.png/.jpg/.jpeg/.tif/.tiff",
        });
      } catch (error) {
        useNotificationStore.getState().addNotification({
          source: captureFiles.length > 0 ? "packet-capture" : "fax-center",
          type: "error",
          title: "Import Failed",
          description: error instanceof Error ? error.message : String(error),
          navigation: { tool: captureFiles.length > 0 ? "packet-capture" : "fax-center" },
        });
      }
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const handleConfirmClose = () => {
    setShowCloseConfirm(false);
    performShutdown();
  };

  // Capture focused element on any right-click so Cut/Copy/Paste/Select All have a target
  useEffect(() => {
    const setEditTarget = useContextMenuStore.getState().setEditTarget;
    const handler = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const editableTarget =
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.getAttribute("role") === "textbox")
          ? target
          : null;
      setEditTarget(editableTarget ?? active);
    };
    document.addEventListener("contextmenu", handler, true);
    return () => document.removeEventListener("contextmenu", handler, true);
  }, []);

  // Sync app-wide User-Agent to backend on load
  useEffect(() => {
    useSettingsStore.getState().syncUserAgentToBackend();
  }, []);

  const handleToggleNotifications = () => {
    const nextOpen = !layout.notificationsCenterOpen;
    layout.setNotificationsCenterOpen(nextOpen);
  };

  const handleToggleNotes = () => {
    const nextOpen = !layout.notesCenterOpen;
    layout.setNotesCenterOpen(nextOpen);
  };

  const handleToggleKnowledgeBase = () => {
    const nextOpen = !layout.kbCenterOpen;
    layout.setKbCenterOpen(nextOpen);
  };

  const handleToggleSettings = () => {
    const nextOpen = !layout.settingsCenterOpen;
    if (nextOpen && !settingsCenterReady) {
      void preloadSettingsCenter().then(() => setSettingsCenterReady(true));
    }
    layout.setSettingsCenterOpen(nextOpen);
  };

  // Sync media port range to backend on load
  useEffect(() => {
    useSettingsStore.getState().syncMediaPortsToBackend();
  }, []);

  // Sync window behavior preferences to backend on load
  useEffect(() => {
    useSettingsStore.getState().syncMinimizeToTrayToBackend();
    useSettingsStore.getState().syncHideDockIconToBackend();
    useSettingsStore.getState().syncShowTrayIconToBackend();
  }, []);

  // Channel-aware updater checks:
  // - immediate check after app boot (if enabled)
  // - periodic checks while app is open
  // - re-check when channel changes
  useEffect(() => {
    if (!toolsReady) return;
    if (!updatePrefs.autoCheckOnLaunch) return;
    void checkForUpdates(updatePrefs.channel);
    const intervalId = window.setInterval(() => {
      void checkForUpdates(updatePrefs.channel);
    }, 30 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [toolsReady, updatePrefs.autoCheckOnLaunch, updatePrefs.channel, checkForUpdates]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ call_id?: string; callId?: string }>("softphone:call_ended_by_remote", (event) => {
      const sipCallId = event.payload.call_id ?? event.payload.callId;
      if (sipCallId) {
        useSoftphoneStore.getState().setCallEndedByRemote(sipCallId);

        useNotificationStore.getState().addNotification({
          type: "info",
          title: "Call Ended",
          description: "The remote party ended the call.",
          source: "soft-phone",
          priority: "normal",
          navigation: { tool: "soft-phone" },
        });
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    const poll = setInterval(async () => {
      try {
        if (document.visibilityState !== "visible") return;
        const hasLiveCalls = useSoftphoneStore
          .getState()
          .calls.some((c) => c.state === "active" || c.state === "ringing" || c.state === "connecting");
        if (!hasLiveCalls) return;
        const ids = await getRemoteEndedCalls();
        for (const sipCallId of ids) {
          useSoftphoneStore.getState().setCallEndedByRemote(sipCallId);
        }
      } catch {
        // ignore
      }
    }, 2000);
    return () => {
      cancelled = true;
      unlisten?.();
      clearInterval(poll);
    };
  }, []);

  // SIP message log: append to the matching call's sipLog
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ call_id: string; direction: "send" | "recv"; method: string; status_code: number; summary: string; raw: string; timestamp: string }>(
      "softphone:sip_message",
      (event) => {
        useSoftphoneStore.getState().appendSipMessage(event.payload.call_id, event.payload);
      },
    ).then((fn) => { if (cancelled) { fn(); } else { unlisten = fn; } });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // DTMF events: append to the matching call's dtmfDigits
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ call_id: string; digit: string; direction: "send" | "recv"; timestamp: string }>(
      "softphone:dtmf_event",
      (event) => {
        const { call_id, digit, direction, timestamp } = event.payload;
        useSoftphoneStore.getState().appendDtmf(call_id, digit, direction, timestamp);
      },
    ).then((fn) => { if (cancelled) { fn(); } else { unlisten = fn; } });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // Call state changes from backend (remote hold/resume from re-INVITE)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ callId: string; event: string }>(
      "softphone:call_state_change",
      (event) => {
        const { callId, event: stateEvent } = event.payload;
        useSoftphoneStore.setState((s) => ({
          calls: s.calls.map((c) => {
            if (c.sipCallId !== callId) return c;
            if (stateEvent === "held_by_remote") return { ...c, state: "on-hold" as const };
            if (stateEvent === "resumed_by_remote") return { ...c, state: "active" as const };
            return c;
          }),
        }));

        if (stateEvent === "held_by_remote") {
          useNotificationStore.getState().addNotification({
            type: "info",
            title: "Call On Hold",
            description: "The remote party placed you on hold.",
            source: "soft-phone",
          });
        } else if (stateEvent === "resumed_by_remote") {
          useNotificationStore.getState().addNotification({
            type: "info",
            title: "Call Resumed",
            description: "The remote party resumed the call.",
            source: "soft-phone",
          });
        }
      },
    ).then((fn) => { if (cancelled) { fn(); } else { unlisten = fn; } });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // BLF state updates from backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ registrarId: string; extension: string; state: string; direction?: string; remoteParty?: string }>(
      "softphone:blf_update",
      (event) => {
        const { registrarId, extension, state } = event.payload;
        useSoftphoneStore.getState().updateBlfState(registrarId, extension, state as "idle" | "busy" | "ringing" | "offline" | "unknown");
      },
    ).then((fn) => { if (cancelled) { fn(); } else { unlisten = fn; } });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // Keep inbound listener lifecycle at app scope so it is not tied to
  // SoftPhoneTool mount/unmount. Reconcile all desired inbound ports at once
  // so fax/voice endpoints can receive concurrently.
  useEffect(() => {
    const hasUseCase = (value: string | null | undefined, target: string) =>
      (value ?? "")
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .includes(target);
    const normalizePort = (port?: number | null) =>
      typeof port === "number" && port > 0 ? port : null;

    const desiredPortsSet = new Set<number>();
    for (const registrar of registrars) {
      if (!hasUseCase(registrar.use_case, "faxing")) continue;
      const inbound =
        normalizePort(registrar.listening_port) ??
        normalizePort(registrar.local_port);
      if (inbound) desiredPortsSet.add(inbound);
    }

    const activeRegistrar = activeRegistrarId
      ? registrars.find((r) => r.id === activeRegistrarId) ?? null
      : null;
    const activeInboundPort =
      normalizePort(activeRegistrar?.listening_port) ??
      normalizePort(activeRegistrar?.local_port);
    if (activeInboundPort) desiredPortsSet.add(activeInboundPort);
    const desiredPorts = Array.from(desiredPortsSet).sort((a, b) => a - b);
    const statusPort = desiredPorts.length === 1 ? (desiredPorts[0] ?? null) : null;

    syncInboundListeners(desiredPorts)
      .then(() => setInboundListenerStatus(desiredPorts.length > 0, statusPort, desiredPorts))
      .catch((e) => {
        console.warn("Failed to sync inbound listeners", desiredPorts, e);
        setInboundListenerStatus(false, null, []);
      });
  }, [activeRegistrarId, registrars, setInboundListenerStatus]);

  useEffect(() => {
    return () => {
      stopInboundListener().catch(() => {});
      setInboundListenerStatus(false, null, []);
    };
  }, [setInboundListenerStatus]);

  // Call park events: update BLF park slot occupancy in real time
  useEffect(() => {
    let unlistenParked: (() => void) | undefined;
    let unlistenUnparked: (() => void) | undefined;
    let cancelled = false;

    listen<{ slot: string; caller?: string; parkedBy?: string }>(
      "pbx:call_parked",
      (event) => {
        const { slot, caller, parkedBy } = event.payload;
        useSoftphoneStore.getState().updateParkSlot(slot, true, caller, parkedBy);
      },
    ).then((fn) => { if (cancelled) { fn(); } else { unlistenParked = fn; } });

    listen<{ slot: string }>(
      "pbx:call_unparked",
      (event) => {
        useSoftphoneStore.getState().updateParkSlot(event.payload.slot, false);
      },
    ).then((fn) => { if (cancelled) { fn(); } else { unlistenUnparked = fn; } });

    return () => {
      cancelled = true;
      unlistenParked?.();
      unlistenUnparked?.();
    };
  }, []);

  // Live transcription events from Vosk
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ call_id?: string; callId?: string; speaker: "local" | "remote"; text: string; is_final?: boolean; isFinal?: boolean; timestamp: string }>(
      "speech:transcript",
      (event) => {
        const sipCallId = event.payload.call_id ?? event.payload.callId;
        const isFinal = event.payload.is_final ?? event.payload.isFinal ?? false;
        const { speaker, text, timestamp } = event.payload;
        if (!sipCallId) return;
        const store = useSoftphoneStore.getState();
        const call = store.calls.find(
          (c) => c.sipCallId === sipCallId || c.id === sipCallId
        );
        if (call) {
          store.appendTranscript(call.id, { speaker, text, isFinal, timestamp });
        }
      },
    ).then((fn) => { if (cancelled) { fn(); } else { unlisten = fn; } });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // Received fax: add to troubleshooting store and timeline
  useEffect(() => {
    const unlistenPromise = listen<{
      callId: string;
      registrarId: string;
      from: string;
      pageCount: number;
      documentBase64?: string | null;
      documentFormat?: string;
    }>("fax:received", (event) => {
      const p = event.payload;
      const receivedAt = new Date().toISOString();
      const fromRaw = p.from ?? "";
      const bracket = fromRaw.indexOf("<");
      const sender =
        bracket >= 0
          ? (fromRaw.slice(0, bracket).trim().replace(/^["']|["']$/g, "") ||
              fromRaw.slice(bracket).replace(/^<|>.*$/g, "").trim())
          : fromRaw.trim() || "Unknown";
      useTroubleshootingStore.getState().addReceivedFax({
        id: p.callId,
        sender,
        receivedAt,
        pageCount: p.pageCount ?? 1,
        documentUrl: p.documentBase64
          ? `data:image/tiff;base64,${p.documentBase64}`
          : undefined,
        documentFormat: (p.documentFormat as "tiff" | "image" | "pdf") ?? "tiff",
        session: {
          sipCallId: p.callId,
          registrarId: p.registrarId,
          success: true,
          startedAt: receivedAt,
        },
      });

      // Notify user of received fax
      const pages = p.pageCount ?? 1;
      useNotificationStore.getState().addNotification({
        type: "success",
        title: "Fax Received",
        description: `${pages} page${pages !== 1 ? "s" : ""} from ${sender}`,
        source: "fax-center",
        priority: "high",
        navigation: { tool: "fax-center", view: "received" },
      });
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Global listener: route incoming fax calls to Fax Center
  // Fax incoming calls use a dedicated fax:incoming_call event, completely separate from softphone.
  // This must be at the app level so it fires even when FaxCenterTool isn't mounted.
  useEffect(() => {
    const unlistenPromise = listen<{
      registrarId: string;
      callId: string;
      from: string;
      fromDisplay: string;
      to: string;
      requestUri: string;
    }>("fax:incoming_call", (event) => {
      const enqueued = useIncomingFaxStore.getState().enqueueIncomingFaxCall(event.payload);

      // Navigate to fax center for inbound fax calls.
      useToolStore.getState().setActiveTool("fax-center");

      // Notify user of incoming fax call
      if (!enqueued) return;
      const from = event.payload.fromDisplay || event.payload.from || "Unknown";
      useNotificationStore.getState().addNotification({
        type: "info",
        title: "Incoming Fax",
        description: `Incoming fax call from ${from}`,
        source: "fax-center",
        priority: "urgent",
        persistent: true,
        navigation: { tool: "fax-center", view: "in_progress" },
      });
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Remote Agent event listeners
  useEffect(() => {
    const unlistenConnected = listen<{ agent_id: string; remote_addr: string; profile?: string; capabilities?: string[] }>(
      "remote-agent:connected",
      (event) => {
        const store = useRemoteAgentStore.getState();
        const addr = event.payload.remote_addr;
        if (addr.startsWith("relay:")) {
          store.removeRelaySession(addr.slice("relay:".length));
        }
        store.handleAgentConnected(
          event.payload.agent_id,
          addr,
          event.payload.profile,
          event.payload.capabilities
        );
      }
    );
    const unlistenDisconnected = listen<{ agent_id: string; reason?: string }>(
      "remote-agent:disconnected",
      (event) => {
        useRemoteAgentStore.getState().handleAgentDisconnected(
          event.payload.agent_id,
          event.payload.reason
        );
      }
    );
    const unlistenResponse = listen<{ agent_id: string; id: string; response: { type: string; data?: unknown } }>(
      "remote-agent:response",
      (event) => {
        useRemoteAgentStore.getState().handleAgentResponse({
          id: event.payload.id,
          response: event.payload.response,
          agentId: event.payload.agent_id,
        });
      }
    );
    const unlistenAuthFailed = listen<{ agent_id: string; remote_addr: string; reason?: string }>(
      "remote-agent:auth-failed",
      (event) => {
        const store = useRemoteAgentStore.getState();
        const agentId = event.payload.agent_id;
        const savedName = store.agentNames[agentId];
        const display = savedName || agentId.slice(0, 8);
        const addr = event.payload.remote_addr.startsWith("relay:") ? "via secure relay" : `from ${event.payload.remote_addr}`;
        store.addLogEntry({
          agentId,
          agentHostname: savedName || null,
          type: "auth_failed",
          message: `Authentication failed for ${display} ${addr}${event.payload.reason ? `: ${event.payload.reason}` : ""}`,
          data: event.payload,
        });
      }
    );
    const unlistenWsError = listen<{ agent_id?: string; error: string }>(
      "remote-agent:ws-error",
      (event) => {
        const store = useRemoteAgentStore.getState();
        const agentId = event.payload.agent_id || null;
        const agent = agentId ? store.connections.find((c) => c.id === agentId) : null;
        const display = agent?.name || agent?.hostname || (agentId ? agentId.slice(0, 8) : "Unknown");
        store.addLogEntry({
          agentId,
          agentHostname: agent?.hostname || agent?.name || null,
          type: "command_error",
          message: `WebSocket error for ${display}: ${event.payload.error}`,
          data: event.payload,
        });
      }
    );
    const unlistenAuthSuccess = listen<{ agent_id: string; remote_addr: string }>(
      "remote-agent:auth-success",
      (event) => {
        const store = useRemoteAgentStore.getState();
        const agentId = event.payload.agent_id;
        const savedName = store.agentNames[agentId];
        const display = savedName || agentId.slice(0, 8);
        const addr = event.payload.remote_addr.startsWith("relay:") ? "via secure relay" : `from ${event.payload.remote_addr}`;
        store.addLogEntry({
          agentId,
          agentHostname: savedName || null,
          type: "auth_success",
          message: `Agent ${display} authenticated ${addr}`,
          data: event.payload,
        });
      }
    );
    const unlistenRelayWaiting = listen<{ session_id: string }>(
      "remote-agent:relay-waiting",
      (event) => {
        const store = useRemoteAgentStore.getState();
        store.addRelaySession(event.payload.session_id);
        store.addLogEntry({
          agentId: null,
          agentHostname: null,
          type: "relay_waiting",
          message: "Relay session active \u2014 waiting for agent to connect",
          data: event.payload,
        });
      }
    );
    const unlistenRelayError = listen<{ session_id: string; error: string }>(
      "remote-agent:relay-error",
      (event) => {
        const store = useRemoteAgentStore.getState();
        store.removeRelaySession(event.payload.session_id);
        store.addLogEntry({
          agentId: null,
          agentHostname: null,
          type: "relay_error",
          message: "Relay connection error \u2014 reconnecting",
          data: event.payload,
        });
      }
    );
    return () => {
      unlistenConnected.then((fn) => fn());
      unlistenDisconnected.then((fn) => fn());
      unlistenResponse.then((fn) => fn());
      unlistenAuthFailed.then((fn) => fn());
      unlistenWsError.then((fn) => fn());
      unlistenAuthSuccess.then((fn) => fn());
      unlistenRelayWaiting.then((fn) => fn());
      unlistenRelayError.then((fn) => fn());
    };
  }, []);

  // Remote chat sync events (broadcast to all windows)
  useEffect(() => {
    const chatStore = useRemoteChatStore.getState();
    const unlistenState = listen<RemoteChatState>(
      "remote-chat:state",
      (event) => {
        chatStore.applyServerState(event.payload);
      }
    );
    const unlistenMessage = listen<RemoteChatMessage>(
      "remote-chat:message",
      (event) => {
        chatStore.appendMessage(event.payload);
      }
    );
    return () => {
      unlistenState.then((fn) => fn());
      unlistenMessage.then((fn) => fn());
    };
  }, []);

  // MCP status/progress events are global so activity persists even when
  // the Tools > MCP subview is not currently visible.
  useEffect(() => {
    const mcpStore = useMcpStore.getState();
    const unlistenStatus = onMcpServerStatus((payload) => {
      mcpStore.handleServerStatusEvent(payload);
    });
    const unlistenProgress = onMcpAgentProgress((payload) => {
      mcpStore.handleAgentProgressEvent(payload);
    });
    return () => {
      unlistenStatus.then((fn) => fn());
      unlistenProgress.then((fn) => fn());
    };
  }, []);

  // Live expert findings from Tauri backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ id: string; ruleId: string; severity: string; category: string; title: string; description: string; detail?: string; evidence: unknown[]; articleId?: string; relatedCallId?: string; count: number; firstSeen: string; lastSeen: string }>(
      "expert:new-finding",
      (event) => {
        const store = usePacketCaptureStore.getState();
        const finding = event.payload as import("./types/packetCapture").ExpertFinding;
        const existing = store.expertFindings;
        if (!existing.find((f) => f.id === finding.id)) {
          usePacketCaptureStore.setState({ expertFindings: [...existing, finding] });
        }
      },
    ).then((fn) => { if (cancelled) { fn(); } else { unlisten = fn; } });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  if (!toolsReady) {
    return (
      <LoadScreen
        loadedCount={loadProgress.loaded}
        totalCount={loadProgress.total}
      />
    );
  }

  return (
    <div
      className={styles.appShell}
      data-visibility={highVisibility ? "high" : "default"}
      data-motion={reducedMotion ? "reduced" : "default"}
      style={{ height: "100vh", width: "100vw" }}
    >
      <GlobalContextMenu />
      <LoadingOverlay />
      <Header
        onNotificationClick={handleToggleNotifications}
        onNotesClick={handleToggleNotes}
        onKnowledgeBaseClick={handleToggleKnowledgeBase}
        onSettingsClick={handleToggleSettings}
        hasUpdateAvailable={Boolean(availableUpdate)}
      />
      <div className={styles.mainRow}>
        {/*
          Isolate + high z-index so tool surfaces (sticky/fixed children, panels) cannot
          steal clicks from the sidebar navigation column.
        */}
        <div className={styles.sidebarRail}>
          <Sidebar />
        </div>
        <div className={`${styles.contentIsland} app-content-island`}>
          <TopographicBackground />
          <div className={styles.contentStack}>
            <ToolContainer />
          </div>
        </div>
      </div>
      <div
        id="app-global-footer-layer"
        className={`${styles.footerLayer} app-chrome-surface`}
      />
      {settings.showToasts && <Toaster position={settings.position} />}
      {layout.notesCenterOpen && (
        <Suspense fallback={null}>
          <NotesCenter isOpen={layout.notesCenterOpen} onClose={() => layout.setNotesCenterOpen(false)} />
        </Suspense>
      )}
      {layout.notificationsCenterOpen && (
        <Suspense fallback={null}>
          <NotificationsCenter
            isOpen={layout.notificationsCenterOpen}
            onClose={() => layout.setNotificationsCenterOpen(false)}
          />
        </Suspense>
      )}
      {knowledgeBaseEnabled && (
        <>
          {layout.kbCenterOpen && (
            <Suspense fallback={null}>
              <KnowledgeBaseCenter isOpen={layout.kbCenterOpen} onClose={() => layout.setKbCenterOpen(false)} />
            </Suspense>
          )}
        </>
      )}
      {settingsCenterReady && (
        <Suspense fallback={null}>
          <SettingsCenter
            isOpen={layout.settingsCenterOpen}
            onClose={() => layout.setSettingsCenterOpen(false)}
          />
        </Suspense>
      )}
      {layout.terminalOpen && (
        <Suspense fallback={null}>
          <FloatingTerminal
            isOpen={layout.terminalOpen}
            minimized={layout.terminalMinimized}
            onMinimizedChange={layout.setTerminalMinimized}
            onClose={() => layout.setTerminalOpen(false)}
          />
        </Suspense>
      )}
      {layout.searchOpen && (
        <Suspense fallback={null}>
          <GlobalSearchDialog />
        </Suspense>
      )}
      {packetViewerSessionId && (
        <Suspense fallback={null}>
          <GlobalPacketViewerModal />
        </Suspense>
      )}
      <ShortcutsPanel
        isOpen={layout.shortcutsPanelOpen}
        onClose={() => layout.setShortcutsPanelOpen(false)}
      />
      <ConfirmDialog
        open={showCloseConfirm}
        onOpenChange={setShowCloseConfirm}
        title="Close SIPalyzer?"
        description="Any unsaved work will be lost. Your session state will be saved automatically."
        confirmText="Close"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleConfirmClose}
      />
    </div>
  );
}

function App() {
  if (isRemoteChatWindow()) {
    return (
      <ErrorBoundary>
        <TooltipProvider delayDuration={300} skipDelayDuration={150}>
          <ToastProvider>
            <RemoteChatWindow />
          </ToastProvider>
        </TooltipProvider>
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
