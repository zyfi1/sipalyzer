/**
 * Preload all tool chunks so they are in cache before the app is shown.
 * Uses the same dynamic import paths as tools.tsx so the lazy() components resolve immediately.
 * Provision Viewer and UnifiedTroubleshootingTool are loaded in the main bundle (not lazy) to avoid React chunk issues.
 */
const TOOL_IMPORTS_BY_ID: Record<string, () => Promise<unknown>> = {
  "packet-capture": () => import("@/components/packet-capture/PacketCaptureTool"),
  registration: () => import("@/components/registration/RegistrationToolset"),
  "soft-phone": () => import("@/components/soft-phone/SoftPhoneTool"),
  "fax-center": () => import("@/components/fax-center/FaxCenterTool"),
  network: () => import("@/components/network/NetworkTool"),
  composer: () => import("@/components/composer/ComposerTool"),
  "remote-agent": () => import("@/components/remote-agent/RemoteAgentTool"),
  "provision-viewer": () => import("@/components/tools/provision-viewer/ProvisionViewerTool"),
  tools: () => import("@/components/tools/ToolsTool"),
  "admin-center": () => import("@/components/admin/AdminCenter"),
};

const TOOL_IMPORTS: Array<() => Promise<unknown>> = [
  TOOL_IMPORTS_BY_ID["packet-capture"]!,
  TOOL_IMPORTS_BY_ID.registration!,
  TOOL_IMPORTS_BY_ID["soft-phone"]!,
  TOOL_IMPORTS_BY_ID["fax-center"]!,
  TOOL_IMPORTS_BY_ID.network!,
  TOOL_IMPORTS_BY_ID.composer!,
  TOOL_IMPORTS_BY_ID["remote-agent"]!,
];

export const TOOL_PRELOAD_COUNT = TOOL_IMPORTS.length;
const CRITICAL_PRELOAD_COUNT = 2;

function scheduleIdle(task: () => void): void {
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => task());
    return;
  }
  window.setTimeout(task, 250);
}

export function preloadAllTools(onProgress?: (loaded: number, total: number) => void): Promise<void> {
  const total = TOOL_IMPORTS.length;
  const isDev = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
  let loaded = 0;
  const report = () => {
    loaded += 1;
    onProgress?.(loaded, total);
  };

  const critical = TOOL_IMPORTS.slice(0, CRITICAL_PRELOAD_COUNT);
  const background = TOOL_IMPORTS.slice(CRITICAL_PRELOAD_COUNT);

  // In dev/Tauri startup, eager chunk warming can starve Vite transforms and
  // make first paint look hung. Keep boot path deterministic: no eager warmup.
  if (isDev) {
    onProgress?.(total, total);
    return Promise.resolve();
  }

  for (const load of background) {
    scheduleIdle(() => {
      load().then(report).catch(() => {});
    });
  }

  // Never reject app boot if a chunk fails to preload in dev/HMR turbulence.
  // We still report progress so the loader can advance and the UI can recover.
  return Promise.allSettled(
    critical.map((load) =>
      load()
        .catch(() => {})
        .then(report),
    ),
  ).then(() => {});
}

export function preloadToolById(toolId: string): Promise<void> {
  const load = TOOL_IMPORTS_BY_ID[toolId];
  if (!load) return Promise.resolve();
  return load().then(() => {});
}
