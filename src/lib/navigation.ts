/**
 * Central navigation: navigateTo + URL (hash) sync.
 * Use navigateTo() when opening a tool (especially Packet Monitor with a session)
 * so the session is set in the store; avoid (window as any).switchToMonitorTab.
 */

import { toolRegistry, HOME_TOOL_ID } from "./toolRegistry";
import {
  FEATURE_FLAG_KNOWLEDGE_BASE_UI,
  FEATURE_FLAG_MCP_UI,
  FEATURE_FLAG_TOOLS_MOCKUP_UI,
} from "./featureFlags";
import { getCachedFeatureFlag, isFeatureFlagEnabled } from "./featureFlagCache";

import { useToolStore } from "@/stores/toolStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useOpenCaptureStore } from "@/hooks/useOpenCapture";

export interface NavigationContext {
  /** When opening packet-capture → viewer, set this session as active in the store. */
  packetCaptureSessionId?: string;
  /** Optional packet details tab to open by default in viewer. */
  viewerDetailsTab?: "overview" | "protocol" | "raw";
}

const HASH_PREFIX = "#";

function resolveToolsSubviewForCachedFlags(subviewId: string | null): string | null {
  if (subviewId === "mockup") {
    const cached = getCachedFeatureFlag(FEATURE_FLAG_TOOLS_MOCKUP_UI);
    if (cached && !cached.enabled) return "syslog";
  }
  if (subviewId === "mcp") {
    const cached = getCachedFeatureFlag(FEATURE_FLAG_MCP_UI);
    if (cached && !cached.enabled) return "syslog";
  }
  return subviewId;
}

function getHash(): string {
  const h = window.location.hash;
  return h.startsWith(HASH_PREFIX) ? h.slice(HASH_PREFIX.length) : "";
}

function getPathAndSearch(): { path: string; search: string } {
  const full = getHash().replace(/^\/+/, "") || "";
  const i = full.indexOf("?");
  if (i >= 0) {
    return { path: full.slice(0, i), search: full.slice(i + 1) };
  }
  return { path: full, search: "" };
}

function parseSearch(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!search.trim()) return out;
  for (const part of search.split("&")) {
    const eq = part.indexOf("=");
    if (eq >= 0) {
      out[decodeURIComponent(part.slice(0, eq)).trim()] = decodeURIComponent(
        part.slice(eq + 1)
      ).trim();
    }
  }
  return out;
}

/** Parse current hash into toolId, subviewId, and optional session id. */
export function parseHash(): {
  toolId: string;
  subviewId: string | null;
  sessionId: string | null;
} {
  const { path, search } = getPathAndSearch();
  const segments = path ? path.split("/").filter(Boolean) : [];
  const query = parseSearch(search);
  const sessionId = query.session ?? null;

  if (segments.length === 0) {
    return { toolId: HOME_TOOL_ID, subviewId: null, sessionId };
  }

  let toolId: string = segments[0] ?? HOME_TOOL_ID;
  let subviewId: string | null = segments.length >= 2 ? (segments[1] ?? null) : null;

  // Legacy deep-links: standalone analysis tool routes now map back into packet-capture/analysis.
  if (toolId === "analysis" || toolId === "forensics") {
    toolId = "packet-capture";
    subviewId = "analysis";
  }

  // Legacy deep-links for KB routes now resolve back to Home.
  if (toolId === "knowledge-base" || toolId === "decision-trees") {
    toolId = HOME_TOOL_ID;
    subviewId = null;
  }

  // Home tool has no subviews — KB is accessed via the slide-out panel
  if (toolId === HOME_TOOL_ID && subviewId) subviewId = null;
  if (toolId === "tools") {
    subviewId = resolveToolsSubviewForCachedFlags(subviewId);
  }

  // Firmware catalog moved from Tools → Device Provisioning
  if (toolId === "tools" && subviewId === "firmware") {
    toolId = "provision-viewer";
    subviewId = "firmware";
  }

  // Legacy: packet-monitor → packet-capture/monitor (merged back)
  if (toolId === "packet-monitor") {
    toolId = "packet-capture";
    subviewId = "monitor";
  }
  if (toolId === HOME_TOOL_ID && subviewId === "registration") {
    toolId = "registration";
    subviewId = null;
  }

  // Validate tool exists
  if (toolRegistry.get(toolId)) {
    return { toolId, subviewId, sessionId };
  }

  return { toolId: HOME_TOOL_ID, subviewId: null, sessionId };
}

/** Build hash string from tool + subview + optional session. */
export function buildHash(
  toolId: string,
  subviewId?: string | null,
  sessionId?: string | null
): string {
  if (toolId === HOME_TOOL_ID && !sessionId && !subviewId) {
    return "#/";
  }
  let path = "/" + toolId;
  if (subviewId) path += "/" + subviewId;
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  const q = params.toString();
  return HASH_PREFIX + path + (q ? "?" + q : "");
}

/** Apply parsed hash to stores (tool + optional packet session). */
export function syncStoreFromHash(): void {
  const { toolId, subviewId, sessionId } = parseHash();
  useToolStore.getState().setActiveTool(toolId, subviewId ?? undefined);
  if (sessionId && toolId === "packet-capture") {
    usePacketCaptureStore.getState().setActiveSession(sessionId);
    // Signal the PacketViewerView to open this session as a tab
    if (subviewId === "viewer") {
      useOpenCaptureStore.getState().openViewer(sessionId);
    }
  }
  const canonical = buildHash(toolId, subviewId, sessionId);
  if (window.location.hash !== canonical) {
    window.history.replaceState(null, "", canonical || "#/");
  }
}

/** Update hash from current store state. */
export function syncHashFromStore(): void {
  const { activeToolId, lastViewedSubviews } = useToolStore.getState();
  if (!activeToolId) return;
  let subviewId: string | null = lastViewedSubviews[activeToolId] ?? null;
  if (activeToolId === HOME_TOOL_ID) subviewId = null;
  let sessionId: string | null = null;
  if (activeToolId === "packet-capture") {
    sessionId = usePacketCaptureStore.getState().activeSessionId;
  }
  const hash = buildHash(activeToolId, subviewId, sessionId);
  const full = window.location.hash;
  if (full !== hash) {
    window.history.replaceState(null, "", hash || "#/");
  }
}

/**
 * Navigate to a tool (and optional subview). Use this instead of setActiveTool
 * when you need to open Packet Monitor with a specific session.
 */
export function navigateTo(
  toolId: string,
  subviewId?: string | null,
  context?: NavigationContext
): void {
  if (
    (toolId === "knowledge-base" || toolId === "decision-trees") &&
    !isFeatureFlagEnabled(FEATURE_FLAG_KNOWLEDGE_BASE_UI, false)
  ) {
    toolId = HOME_TOOL_ID;
    subviewId = null;
  }
  if (toolId === "tools" && subviewId === "mockup" && !isFeatureFlagEnabled(FEATURE_FLAG_TOOLS_MOCKUP_UI, false)) {
    subviewId = "syslog";
  }
  if (toolId === "tools" && subviewId === "mcp" && !isFeatureFlagEnabled(FEATURE_FLAG_MCP_UI, false)) {
    subviewId = "syslog";
  }
  if (toolId === "tools" && subviewId === "firmware") {
    toolId = "provision-viewer";
    subviewId = "firmware";
  }

  const tool = toolRegistry.get(toolId);
  if (!tool) return;

  useToolStore.getState().setActiveTool(toolId, subviewId ?? undefined);

  if (context?.packetCaptureSessionId && toolId === "packet-capture") {
    usePacketCaptureStore.getState().setActiveSession(
      context.packetCaptureSessionId
    );
    // Signal the PacketViewerView to open this session as a tab
    if (subviewId === "viewer") {
      useOpenCaptureStore.getState().openViewer(
        context.packetCaptureSessionId,
        undefined,
        context.viewerDetailsTab ? { detailsTab: context.viewerDetailsTab } : undefined
      );
    }
  }

  const sessionId =
    toolId === "packet-capture" && context?.packetCaptureSessionId
      ? context.packetCaptureSessionId
      : null;
  const hash = buildHash(
    toolId,
    subviewId ?? useToolStore.getState().lastViewedSubviews[toolId] ?? null,
    sessionId
  );
  window.history.pushState(null, "", hash || "#/");
}

/** Initialize hash from store on load, keep hash in sync with store, and handle back/forward. */
export function initHashSync(): () => void {
  const hash = getHash();
  if (hash && hash !== "/" && hash !== "#/") {
    syncStoreFromHash();
  } else {
    syncHashFromStore();
  }

  const handlePopState = () => {
    syncStoreFromHash();
  };
  window.addEventListener("popstate", handlePopState);

  // Defer hash sync to next frame so store update + re-renders complete first (snappier view switch)
  const scheduleHashSync = () => {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(syncHashFromStore);
    } else {
      setTimeout(syncHashFromStore, 0);
    }
  };
  const unsubTool = useToolStore.subscribe(scheduleHashSync);
  const unsubPacketCapture = usePacketCaptureStore.subscribe(scheduleHashSync);

  return () => {
    window.removeEventListener("popstate", handlePopState);
    unsubTool();
    unsubPacketCapture();
  };
}
