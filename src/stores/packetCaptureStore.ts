import { create } from "zustand";
import * as packetCaptureApi from "@/api/packetCapture";
import type { NetworkInterface, CaptureSession, CaptureFolder, CaptureStatistics, FilterConfig, ScheduledCapture, RtpStreamInfo, RemoteCaptureConfig, ExpertFinding } from "@/types/packetCapture";
import type { PacketFilter } from "@/types/filter";
import type { ExecutionContext } from "@/stores/executionContextStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";
import { dispatchProbeCapturePerm, dispatchRequestCapturePerm } from "@/lib/executionDispatch";
import type { NormalizedCapturePermStatus } from "@/lib/resultNormalizers";
import { getAnalysisDiagnostics } from "@/lib/diagnostics/query";

// Debounce timer for fetchSessions
let fetchSessionsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const FETCH_SESSIONS_DEBOUNCE_MS = 500;

// Request version tracking to ignore stale responses
let currentSessionVersion = 0;

// AbortController for cancellable requests
let fetchSessionAbortController: AbortController | null = null;
let fetchSessionsAbortController: AbortController | null = null;

interface PacketCaptureState {
  // Available interfaces
  interfaces: NetworkInterface[];
  loadingInterfaces: boolean;
  
  /** Session IDs currently capturing (multiple allowed). */
  runningSessionIds: string[];
  /** Which session's packets are shown in the monitor (one of running or a loaded stopped session). */
  activeSessionId: string | null;
  activeSession: CaptureSession | null;
  statistics: CaptureStatistics | null;
  
  /** Request versioning to prevent stale data overwrites */
  sessionVersion: number;
  /** Loading state for active session fetch */
  loadingActiveSession: boolean;
  
  // Session list
  sessions: CaptureSession[];
  loadingSessions: boolean;
  
  // UI state
  selectedSessionId: string | null;
  /** True when at least one capture is running. */
  isCapturing: boolean;
  /** True when the Packet Monitor is actively capturing. Set by PacketMonitorView. */
  packetMonitorActive: boolean;
  
  /** Active remote capture via agent (agentId, commandId). Null when local or no capture. */
  remoteCapture: { agentId: string; commandId: string; running: boolean } | null;
  /** Last capture source: local API or remote agent. */
  lastSource: "local" | "remote" | null;
  
  // Persistent UI state (survives view switches)
  selectedInterface: string;
  displayFilter: PacketFilter;
  wiresharkFilter: string;
  
  // Scheduled captures
  scheduledCaptures: ScheduledCapture[];
  loadingScheduledCaptures: boolean;
  
  // Folder & tag organization
  captureFolders: CaptureFolder[];
  selectedFolderId: string | null; // null = All, "" = Unfiled
  selectedTags: string[];
  
  // Actions
  fetchInterfaces: () => Promise<void>;
  startCapture: (name: string, description: string | null, interfaceName: string, filterConfig: FilterConfig, ctx?: ExecutionContext) => Promise<string>;
  stopCapture: (sessionId: string) => Promise<void>;
  fetchStatistics: (sessionId: string) => Promise<void>;
  fetchSessions: () => Promise<void>;
  fetchSessionsImmediate: () => Promise<void>;
  fetchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteAllSessions: (onlyStatus?: "stopped" | "all") => Promise<{ deleted: number; failed: number }>;
  renameSession: (sessionId: string, newName: string) => Promise<void>;
  exportPcap: (sessionId: string, outputPath?: string) => Promise<string>;
  setSelectedSession: (sessionId: string | null) => void;
  setActiveSession: (sessionId: string | null) => void;
  setSelectedInterface: (interfaceName: string) => void;
  setPacketMonitorActive: (active: boolean) => void;
  setDisplayFilter: (filter: PacketFilter) => void;
  setWiresharkFilter: (filter: string) => void;
  /** When set, RawPacketMonitor will select the first SIP packet matching methodOrCode (and optional cseq). Cleared after selection. */
  selectPacketBySip: { methodOrCode: string; cseq?: string } | null;
  setSelectPacketBySip: (v: { methodOrCode: string; cseq?: string } | null) => void;
  /** When set from packet monitor "Open in SIP Ladder", SIP Ladder view will select this session then clear. */
  sipLadderRequestedSessionId: string | null;
  setSipLadderRequestedSessionId: (sessionId: string | null) => void;
  /** Tracks the currently-active session in the Viewer tab so Analysis can auto-sync. */
  viewerActiveSessionId: string | null;
  setViewerActiveSessionId: (sessionId: string | null) => void;
  /** Request that Packet Monitor open a saved capture session. */
  captureSessionOpenRequestId: string | null;
  requestCaptureSessionOpen: (sessionId: string) => void;
  clearCaptureSessionOpenRequest: () => void;
  fetchScheduledCaptures: () => Promise<void>;
  createScheduledCapture: (name: string, description: string | null, interfaceName: string, filterConfig: FilterConfig, scheduleType: 'one_time' | 'recurring', scheduledTime: string, durationSeconds?: number) => Promise<string>;
  updateScheduledCapture: (id: string, updates: Partial<ScheduledCapture>) => Promise<void>;
  deleteScheduledCapture: (id: string) => Promise<void>;
  getRtpStreams: (sessionId: string) => Promise<RtpStreamInfo[]>;
  cleanupSessions: () => Promise<packetCaptureApi.SessionCleanupResult>;
  
  // Folder & tag actions
  fetchCaptureFolders: () => Promise<void>;
  createCaptureFolder: (name: string) => Promise<CaptureFolder>;
  renameCaptureFolder: (id: string, name: string) => Promise<void>;
  deleteCaptureFolder: (id: string) => Promise<void>;
  updateSessionFolder: (sessionId: string, folderId: string | null) => Promise<void>;
  updateSessionTags: (sessionId: string, tags: string[]) => Promise<void>;
  setSelectedFolderId: (id: string | null) => void;
  toggleTagFilter: (tag: string) => void;
  clearTagFilters: () => void;
  
  // Remote capture
  remoteSessionIds: string[];
  startRemoteCapture: (config: RemoteCaptureConfig) => Promise<string>;
  stopRemoteCapture: (sessionId: string) => Promise<void>;
  fetchActiveRemoteSessions: () => Promise<void>;

  // Capture permissions (remote agent)
  capturePermStatus: NormalizedCapturePermStatus | null;
  probeCapturePerm: (ctx: ExecutionContext) => Promise<NormalizedCapturePermStatus>;
  requestCapturePerm: (ctx: ExecutionContext) => Promise<NormalizedCapturePermStatus>;

  // Expert findings
  expertFindings: ExpertFinding[];
  expertFindingsLoading: boolean;
  expertFindingsSessionId: string | null;
  expertLivePollingActive: boolean;
  expertLastAnalyzedPacketCount: number;
  _expertPollInterval: number | null;
  fetchExpertFindings: (sessionId: string) => Promise<void>;
  clearExpertFindings: () => void;
  startExpertLivePolling: (sessionId: string) => void;
  stopExpertLivePolling: () => void;
}

export const usePacketCaptureStore = create<PacketCaptureState>((set, get) => ({
      interfaces: [],
      loadingInterfaces: false,
      runningSessionIds: [],
      activeSessionId: null,
      activeSession: null,
      statistics: null,
      sessionVersion: 0,
      loadingActiveSession: false,
      sessions: [],
      loadingSessions: false,
      selectedSessionId: null,
      isCapturing: false,
      packetMonitorActive: false,
      selectedInterface: "",
      displayFilter: { protocols: [] },
      wiresharkFilter: "",
      selectPacketBySip: null,
      sipLadderRequestedSessionId: null,
      viewerActiveSessionId: null,
      captureSessionOpenRequestId: null,
      scheduledCaptures: [],
      loadingScheduledCaptures: false,
      captureFolders: [],
      selectedFolderId: null,
      selectedTags: [],
      remoteSessionIds: [],
      remoteCapture: null,
      lastSource: null,
      capturePermStatus: null,
      expertFindings: [],
      expertFindingsLoading: false,
      expertFindingsSessionId: null,
      expertLivePollingActive: false,
      expertLastAnalyzedPacketCount: 0,
      _expertPollInterval: null,

  setSelectPacketBySip: (v) => set({ selectPacketBySip: v }),
  setSipLadderRequestedSessionId: (sessionId) => set({ sipLadderRequestedSessionId: sessionId }),
  setViewerActiveSessionId: (sessionId) => set({ viewerActiveSessionId: sessionId }),
  requestCaptureSessionOpen: (sessionId) => set({ captureSessionOpenRequestId: sessionId }),
  clearCaptureSessionOpenRequest: () => set({ captureSessionOpenRequestId: null }),

  fetchInterfaces: async () => {
    set({ loadingInterfaces: true });
    try {
      const interfaces = await packetCaptureApi.listInterfaces();
      set({ interfaces, loadingInterfaces: false });
    } catch (error) {
      console.error("Failed to fetch interfaces:", error);
      set({ loadingInterfaces: false });
    }
  },

  startCapture: async (name, description, interfaceName, filterConfig, ctx) => {
    const resolvedCtx = ctx ?? { type: "local" as const };
    if (resolvedCtx.type === "remote") {
      const params: Record<string, unknown> = {
        interface: interfaceName,
        continuous: true,
      };
      const commandId = await useRemoteAgentStore.getState().sendCommand(
        resolvedCtx.agentId,
        "PacketCapture",
        params
      );

      // Must await — the backend session MUST exist before the first
      // StreamData frames arrive or injectAgentRawFrames will silently
      // drop every packet ("Agent session not found").
      await packetCaptureApi.createAgentCaptureSession(commandId, name, interfaceName);

      const { runningSessionIds, sessionVersion } = get();
      const nextRunning = [...runningSessionIds, commandId];
      const placeholderSession: CaptureSession = {
        id: commandId,
        name,
        description: description ?? undefined,
        interface: interfaceName,
        filterConfig,
        startTime: new Date().toISOString(),
        status: "Running",
        packetCount: 0,
        filePath: "",
        tags: [],
      };
      const newVersion = sessionVersion + 1;
      currentSessionVersion = newVersion;
      set({
        runningSessionIds: nextRunning,
        activeSessionId: commandId,
        activeSession: placeholderSession,
        isCapturing: true,
        sessionVersion: newVersion,
        remoteCapture: { agentId: resolvedCtx.agentId, commandId, running: true },
        lastSource: "remote",
      });
      return commandId;
    }
    try {
      const sessionId = await packetCaptureApi.startCapture(name, description, interfaceName, filterConfig);
      const { runningSessionIds, sessionVersion } = get();
      const nextRunning = [...runningSessionIds, sessionId];
      // Create a placeholder session so workspace cards can render immediately
      const placeholderSession: CaptureSession = {
        id: sessionId,
        name,
        description: description ?? undefined,
        interface: interfaceName,
        filterConfig,
        startTime: new Date().toISOString(),
        status: "Running",
        packetCount: 0,
        filePath: "",
        tags: [],
      };
      
      // Increment version to invalidate any in-flight requests
      const newVersion = sessionVersion + 1;
      currentSessionVersion = newVersion;
      
      set({
        runningSessionIds: nextRunning,
        activeSessionId: sessionId,
        activeSession: placeholderSession,
        isCapturing: true,
        sessionVersion: newVersion,
        remoteCapture: null,
        lastSource: "local",
      });
      // Fetch full session details in background (will update activeSession with real data)
      get().fetchSession(sessionId).catch(() => {});
      return sessionId;
    } catch (error) {
      console.error("Failed to start capture:", error);
      throw error;
    }
  },

  stopCapture: async (sessionId) => {
    const { remoteCapture } = get();
    if (remoteCapture?.commandId === sessionId && remoteCapture.running) {
      try {
        await useRemoteAgentStore.getState().sendCommand(
          remoteCapture.agentId,
          "StopCapture",
          { command_id: remoteCapture.commandId }
        );
      } catch (error) {
        console.error("Failed to stop remote capture:", error);
        throw error;
      }
      // Stop the backend session immediately so the UI can fetch final packets
      packetCaptureApi.stopAgentCaptureSession(sessionId).catch(() => {});
      const { runningSessionIds, activeSessionId, sessionVersion } = get();
      const nextRunning = runningSessionIds.filter((id) => id !== sessionId);
      const keepCurrentActive = activeSessionId === sessionId;
      const nextActive = keepCurrentActive ? sessionId : activeSessionId;
      const newVersion = sessionVersion + 1;
      currentSessionVersion = newVersion;
      set({
        runningSessionIds: nextRunning,
        isCapturing: nextRunning.length > 0,
        activeSessionId: nextActive,
        sessionVersion: newVersion,
        remoteCapture: null,
      });
      return;
    }
    try {
      await packetCaptureApi.stopCapture(sessionId);
      const { runningSessionIds, activeSessionId, sessionVersion } = get();
      const nextRunning = runningSessionIds.filter((id) => id !== sessionId);
      
      // Keep the stopped session as active so user can view captured packets
      // Only switch if we were viewing a different session that's still running
      const keepCurrentActive = activeSessionId === sessionId;
      const nextActive = keepCurrentActive 
        ? sessionId  // Keep the stopped session as active to view its data
        : activeSessionId;
      
      // Increment version to properly sequence updates
      const newVersion = sessionVersion + 1;
      currentSessionVersion = newVersion;
      
      set({
        runningSessionIds: nextRunning,
        isCapturing: nextRunning.length > 0,
        activeSessionId: nextActive,
        sessionVersion: newVersion,
        remoteCapture: null,
        // Don't clear activeSession - we want to keep showing the data
        // The session will be refreshed below to update its status to "Stopped"
      });
      
      // Refresh the stopped session to update its status and stats
      get().fetchSession(sessionId).catch(() => {});
      // Refresh session list in background with debounce (not blocking UI)
      get().fetchSessions().catch(() => {});
    } catch (error) {
      console.error("Failed to stop capture:", error);
      throw error;
    }
  },

  fetchStatistics: async (sessionId) => {
    try {
      const stats = await packetCaptureApi.getCaptureStatistics(sessionId);
      set({ statistics: stats });
    } catch (error) {
      console.error("Failed to fetch statistics:", error);
    }
  },

  // Debounced fetchSessions - prevents rapid overwrites during start/stop sequences
  fetchSessions: async () => {
    // Clear any pending debounce
    if (fetchSessionsDebounceTimer) {
      clearTimeout(fetchSessionsDebounceTimer);
    }
    
    return new Promise<void>((resolve) => {
      fetchSessionsDebounceTimer = setTimeout(async () => {
        await get().fetchSessionsImmediate();
        resolve();
      }, FETCH_SESSIONS_DEBOUNCE_MS);
    });
  },

  // Immediate fetch without debouncing (for initial load, etc.)
  fetchSessionsImmediate: async () => {
    // Cancel any in-flight request
    if (fetchSessionsAbortController) {
      fetchSessionsAbortController.abort();
    }
    fetchSessionsAbortController = new AbortController();
    
    const requestVersion = currentSessionVersion;
    set({ loadingSessions: true });
    
    try {
      const sessions = await packetCaptureApi.listCaptureSessions();
      
      // Check if this request is still valid (no newer version started)
      if (currentSessionVersion !== requestVersion) {
        console.log("[Store] Ignoring stale fetchSessions response");
        return;
      }
      
      const runningIds = sessions.filter((s) => s.status === "Running").map((s) => s.id);
      const state = get();
      
      // Only update activeSessionId if it's not already set or is invalid
      const activeStillValid = state.activeSessionId && 
        sessions.some((s) => s.id === state.activeSessionId);
      const nextActive = activeStillValid 
        ? state.activeSessionId 
        : runningIds[0] ?? null;
      
      set({
        sessions,
        runningSessionIds: runningIds,
        isCapturing: runningIds.length > 0,
        // Only change activeSessionId if current one is invalid
        activeSessionId: activeStillValid ? state.activeSessionId : nextActive,
        loadingSessions: false,
      });
      
      // Only fetch session details if we changed to a new active session
      if (nextActive && nextActive !== state.activeSessionId) {
        get().fetchSession(nextActive);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log("[Store] fetchSessions aborted");
        return;
      }
      console.error("Failed to fetch sessions:", error);
      set({ loadingSessions: false });
    }
  },

  fetchSession: async (sessionId) => {
    // Cancel any in-flight session fetch
    if (fetchSessionAbortController) {
      fetchSessionAbortController.abort();
    }
    fetchSessionAbortController = new AbortController();
    
    const requestVersion = currentSessionVersion;
    const requestedSessionId = sessionId;
    
    set({ loadingActiveSession: true });
    
    try {
      const session = await packetCaptureApi.getCaptureSession(sessionId);
      
      // Check if this request is still valid
      const currentState = get();
      if (currentSessionVersion !== requestVersion) {
        console.log("[Store] Ignoring stale fetchSession response for", sessionId);
        return;
      }
      
      // Only update if we're still expecting this session
      if (currentState.activeSessionId !== requestedSessionId) {
        console.log("[Store] Active session changed, ignoring response for", sessionId);
        return;
      }
      
      set({ 
        activeSession: session,
        loadingActiveSession: false,
      });
      
      // If it's running, fetch statistics in the background (don't block)
      if (session.status === "Running") {
        get().fetchStatistics(sessionId).catch(() => {});
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log("[Store] fetchSession aborted");
        return;
      }
      console.error("Failed to fetch session:", error);
      set({ loadingActiveSession: false });
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await packetCaptureApi.deleteCaptureSession(sessionId);
      const { runningSessionIds, activeSessionId, selectedSessionId } = get();
      const nextRunning = runningSessionIds.filter((id) => id !== sessionId);
      let updates: Partial<PacketCaptureState> = {
        runningSessionIds: nextRunning,
        isCapturing: nextRunning.length > 0,
      };
      if (selectedSessionId === sessionId) updates.selectedSessionId = null;
      if (activeSessionId === sessionId) {
        updates.activeSessionId = nextRunning[0] ?? null;
        updates.activeSession = null;
        updates.statistics = null;
      }
      set(updates);
      await get().fetchSessions();
    } catch (error) {
      console.error("Failed to delete session:", error);
      throw error;
    }
  },

  deleteAllSessions: async (onlyStatus = "stopped") => {
    const { sessions, runningSessionIds } = get();
    const toDelete = onlyStatus === "all"
      ? sessions.map((s) => s.id)
      : sessions.filter((s) => s.status !== "Running").map((s) => s.id);

    let deleted = 0;
    let failed = 0;

    for (const id of toDelete) {
      try {
        await packetCaptureApi.deleteCaptureSession(id);
        deleted++;
      } catch {
        failed++;
      }
    }

    // Clean up store state after batch
    const { activeSessionId, selectedSessionId } = get();
    const deletedSet = new Set(toDelete);
    const nextRunning = runningSessionIds.filter((id) => !deletedSet.has(id));
    const updates: Partial<PacketCaptureState> = {
      runningSessionIds: nextRunning,
      isCapturing: nextRunning.length > 0,
    };
    if (selectedSessionId && deletedSet.has(selectedSessionId)) updates.selectedSessionId = null;
    if (activeSessionId && deletedSet.has(activeSessionId)) {
      updates.activeSessionId = nextRunning[0] ?? null;
      updates.activeSession = null;
      updates.statistics = null;
    }
    set(updates);
    await get().fetchSessions();

    return { deleted, failed };
  },

  renameSession: async (sessionId, newName) => {
    // Update local state immediately (optimistic update)
    const { sessions, activeSession } = get();
    set({
      sessions: sessions.map((s) => 
        s.id === sessionId ? { ...s, name: newName } : s
      ),
      activeSession: activeSession?.id === sessionId 
        ? { ...activeSession, name: newName } 
        : activeSession,
    });
    
    // Try to persist to backend (may not be implemented yet)
    try {
      await packetCaptureApi.updateCaptureSession(sessionId, { name: newName });
    } catch (error) {
      // Backend may not support this yet - local rename still works for current session
      console.warn("Backend rename not supported yet, local rename applied:", error);
    }
  },

  exportPcap: async (sessionId, outputPath?: string) => {
    try {
      const exportedPath = await packetCaptureApi.exportPcap(sessionId, outputPath ?? null);
      return exportedPath;
    } catch (error) {
      console.error("Failed to export PCAP:", error);
      throw error;
    }
  },

  setSelectedSession: (sessionId) => {
    set({ selectedSessionId: sessionId });
  },

  setActiveSession: (sessionId) => {
    const { sessionVersion } = get();
    const newVersion = sessionVersion + 1;
    currentSessionVersion = newVersion;
    
    set({ 
      activeSessionId: sessionId,
      sessionVersion: newVersion,
      loadingActiveSession: sessionId !== null,
    });
    
    if (sessionId) {
      get().fetchSession(sessionId);
    } else {
      set({ activeSession: null, statistics: null, loadingActiveSession: false });
    }
  },

  setSelectedInterface: (interfaceName) => {
    set({ selectedInterface: interfaceName });
  },

  setPacketMonitorActive: (active) => {
    set({ packetMonitorActive: active });
  },

  setDisplayFilter: (filter) => {
    set({ displayFilter: filter });
  },

  setWiresharkFilter: (filter) => {
    set({ wiresharkFilter: filter });
  },

  fetchScheduledCaptures: async () => {
    set({ loadingScheduledCaptures: true });
    try {
      const captures = await packetCaptureApi.listScheduledCaptures();
      set({ scheduledCaptures: captures, loadingScheduledCaptures: false });
    } catch (error) {
      console.error("Failed to fetch scheduled captures:", error);
      set({ loadingScheduledCaptures: false });
    }
  },

  createScheduledCapture: async (name, description, interfaceName, filterConfig, scheduleType, scheduledTime, durationSeconds) => {
    try {
      const id = await packetCaptureApi.createScheduledCapture(
        name,
        description,
        interfaceName,
        filterConfig,
        scheduleType,
        scheduledTime,
        durationSeconds ?? undefined
      );
      await get().fetchScheduledCaptures();
      return id;
    } catch (error) {
      console.error("Failed to create scheduled capture:", error);
      throw error;
    }
  },

  updateScheduledCapture: async (id, updates) => {
    try {
      await packetCaptureApi.updateScheduledCapture(id, updates);
      await get().fetchScheduledCaptures();
    } catch (error) {
      console.error("Failed to update scheduled capture:", error);
      throw error;
    }
  },

  deleteScheduledCapture: async (id) => {
    try {
      await packetCaptureApi.deleteScheduledCapture(id);
      await get().fetchScheduledCaptures();
    } catch (error) {
      console.error("Failed to delete scheduled capture:", error);
      throw error;
    }
  },

  getRtpStreams: async (sessionId) => {
    return packetCaptureApi.getRtpStreams(sessionId);
  },

  cleanupSessions: async () => {
    try {
      const result = await packetCaptureApi.cleanupSessions();
      console.log(`[Store] Cleaned up ${result.evictedCount} sessions, ${result.sessionsAfter} remaining`);
      return result;
    } catch (error) {
      console.error("Failed to cleanup sessions:", error);
      throw error;
    }
  },

  startRemoteCapture: async (config) => {
    try {
      const sessionId = await packetCaptureApi.startRemoteCapture(config);
      const { runningSessionIds, remoteSessionIds } = get();
      set({
        runningSessionIds: [...runningSessionIds, sessionId],
        remoteSessionIds: [...remoteSessionIds, sessionId],
        activeSessionId: sessionId,
        isCapturing: true,
      });
      return sessionId;
    } catch (error) {
      console.error("Failed to start remote capture:", error);
      throw error;
    }
  },

  stopRemoteCapture: async (sessionId) => {
    try {
      await packetCaptureApi.stopRemoteCapture(sessionId);
      const { runningSessionIds, remoteSessionIds } = get();
      const nextRunning = runningSessionIds.filter((id) => id !== sessionId);
      const nextRemote = remoteSessionIds.filter((id) => id !== sessionId);
      set({
        runningSessionIds: nextRunning,
        remoteSessionIds: nextRemote,
        isCapturing: nextRunning.length > 0,
      });
    } catch (error) {
      console.error("Failed to stop remote capture:", error);
      throw error;
    }
  },

  fetchActiveRemoteSessions: async () => {
    try {
      const ids = await packetCaptureApi.getActiveRemoteSessions();
      set({ remoteSessionIds: ids });
    } catch (error) {
      console.error("Failed to fetch active remote sessions:", error);
    }
  },

  probeCapturePerm: async (ctx) => {
    const localStub = async (): Promise<NormalizedCapturePermStatus> => ({
      available: true,
      method: "local",
      detail: "Local capture always available",
    });
    try {
      const res = await dispatchProbeCapturePerm(ctx, localStub);
      set({ capturePermStatus: res.result });
      return res.result;
    } catch (error) {
      console.error("Failed to probe capture permissions:", error);
      throw error;
    }
  },

  requestCapturePerm: async (ctx) => {
    const localStub = async (): Promise<NormalizedCapturePermStatus> => ({
      available: true,
      method: "local",
      detail: "Local capture always available",
    });
    try {
      const res = await dispatchRequestCapturePerm(ctx, localStub);
      set({ capturePermStatus: res.result });
      return res.result;
    } catch (error) {
      console.error("Failed to request capture permissions:", error);
      throw error;
    }
  },

  // ── Folder & tag actions ──

  fetchCaptureFolders: async () => {
    try {
      const folders = await packetCaptureApi.listCaptureFolders();
      set({ captureFolders: folders });
    } catch (error) {
      console.error("Failed to fetch capture folders:", error);
    }
  },

  createCaptureFolder: async (name) => {
    const folder = await packetCaptureApi.createCaptureFolder(name);
    set({ captureFolders: [...get().captureFolders, folder] });
    return folder;
  },

  renameCaptureFolder: async (id, name) => {
    await packetCaptureApi.renameCaptureFolder(id, name);
    set({
      captureFolders: get().captureFolders.map((f) =>
        f.id === id ? { ...f, name } : f
      ),
    });
  },

  deleteCaptureFolder: async (id) => {
    await packetCaptureApi.deleteCaptureFolder(id);
    const { captureFolders, selectedFolderId, sessions } = get();
    set({
      captureFolders: captureFolders.filter((f) => f.id !== id),
      // If we were viewing the deleted folder, go back to "All"
      selectedFolderId: selectedFolderId === id ? null : selectedFolderId,
      // Optimistic: unset folder_id on affected sessions locally
      sessions: sessions.map((s) =>
        s.folderId === id ? { ...s, folderId: undefined } : s
      ),
    });
  },

  updateSessionFolder: async (sessionId, folderId) => {
    // Optimistic update
    const { sessions, activeSession } = get();
    set({
      sessions: sessions.map((s) =>
        s.id === sessionId ? { ...s, folderId: folderId ?? undefined } : s
      ),
      activeSession:
        activeSession?.id === sessionId
          ? { ...activeSession, folderId: folderId ?? undefined }
          : activeSession,
    });
    await packetCaptureApi.updateCaptureSession(sessionId, { folderId });
  },

  updateSessionTags: async (sessionId, tags) => {
    // Optimistic update
    const { sessions, activeSession } = get();
    set({
      sessions: sessions.map((s) =>
        s.id === sessionId ? { ...s, tags } : s
      ),
      activeSession:
        activeSession?.id === sessionId
          ? { ...activeSession, tags }
          : activeSession,
    });
    await packetCaptureApi.updateCaptureSession(sessionId, { tags });
  },

  setSelectedFolderId: (id) => set({ selectedFolderId: id }),

  toggleTagFilter: (tag) => {
    const { selectedTags } = get();
    if (selectedTags.includes(tag)) {
      set({ selectedTags: selectedTags.filter((t) => t !== tag) });
    } else {
      set({ selectedTags: [...selectedTags, tag] });
    }
  },

  clearTagFilters: () => set({ selectedTags: [] }),

  fetchExpertFindings: async (sessionId) => {
    set({ expertFindingsLoading: true });
    try {
      const findings = await getAnalysisDiagnostics(sessionId);
      set({
        expertFindings: findings,
        expertFindingsLoading: false,
        expertFindingsSessionId: sessionId,
        expertLastAnalyzedPacketCount: get().statistics?.totalPackets ?? 0,
      });
    } catch (error) {
      console.error("Failed to fetch expert findings:", error);
      set({ expertFindingsLoading: false });
    }
  },

  clearExpertFindings: () => {
    const state = get();
    if (state._expertPollInterval) clearInterval(state._expertPollInterval);
    set({
      expertFindings: [],
      expertFindingsLoading: false,
      expertFindingsSessionId: null,
      expertLivePollingActive: false,
      expertLastAnalyzedPacketCount: 0,
      _expertPollInterval: null,
    });
  },

  startExpertLivePolling: (sessionId) => {
    const state = get();
    if (state._expertPollInterval) clearInterval(state._expertPollInterval);

    const intervalId = setInterval(async () => {
      const s = get();
      const currentCount = s.statistics?.totalPackets ?? 0;
      const lastCount = s.expertLastAnalyzedPacketCount;
      if (currentCount > lastCount + 50) {
        try {
          const findings = await getAnalysisDiagnostics(sessionId);
          set({ expertFindings: findings, expertLastAnalyzedPacketCount: currentCount });
        } catch { /* ignore polling errors */ }
      }
    }, 10_000);

    set({
      expertLivePollingActive: true,
      expertFindingsSessionId: sessionId,
      _expertPollInterval: intervalId as unknown as number,
    });
  },

  stopExpertLivePolling: () => {
    const state = get();
    if (state._expertPollInterval) clearInterval(state._expertPollInterval);
    set({ expertLivePollingActive: false, _expertPollInterval: null });
  },
}));

function buildPacketCaptureActivityItems(state: PacketCaptureState): ActivityMonitorWorkItem[] {
  const rows: ActivityMonitorWorkItem[] = [];
  for (const session of state.sessions) {
    const status = String(session.status).toLowerCase();
    if (!(state.runningSessionIds.includes(session.id) || status === "running")) continue;
    rows.push({
      key: `cap-${session.id}`,
      name: `Capture: ${session.name || session.id}`,
      detail: `${session.packetCount ?? 0} packets`,
      state: "running",
      cpuPct: 24,
      memMb: 180,
      startedAt: new Date(session.startTime).getTime() || Date.now(),
      kind: "capture",
      captureSessionId: session.id,
      canStop: true,
    });
  }

  if (rows.length === 0 && (state.isCapturing || state.packetMonitorActive || state.remoteCapture?.running)) {
    const fallbackId = state.activeSession?.id ?? state.remoteCapture?.commandId;
    const fallbackName =
      state.activeSession?.name
      || (state.remoteCapture?.running ? `Remote capture (${state.remoteCapture.agentId})` : "Packet monitor capture");
    rows.push({
      key: "cap-monitor-generic",
      name: `Capture: ${fallbackName}`,
      detail: "Capture pipeline active",
      state: "running",
      cpuPct: 18,
      memMb: 128,
      startedAt: Date.now() - 10_000,
      kind: "capture",
      captureSessionId: fallbackId,
      canStop: Boolean(fallbackId),
    });
  }

  if (state.loadingSessions) {
    rows.push({
      key: "cap-loading-sessions",
      name: "Capture session sync",
      detail: "Refreshing capture sessions",
      state: "running",
      cpuPct: 7,
      memMb: 78,
      startedAt: Date.now() - 4_000,
      kind: "capture",
    });
  }
  if (state.loadingActiveSession) {
    rows.push({
      key: "cap-loading-active",
      name: "Capture detail load",
      detail: "Loading active capture details",
      state: "running",
      cpuPct: 7,
      memMb: 82,
      startedAt: Date.now() - 4_000,
      kind: "capture",
    });
  }
  if (state.loadingInterfaces) {
    rows.push({
      key: "cap-loading-interfaces",
      name: "Capture interface scan",
      detail: "Enumerating network interfaces",
      state: "running",
      cpuPct: 5,
      memMb: 70,
      startedAt: Date.now() - 4_000,
      kind: "capture",
    });
  }
  if (state.loadingScheduledCaptures) {
    rows.push({
      key: "cap-loading-scheduled",
      name: "Scheduled capture refresh",
      detail: "Fetching capture schedule list",
      state: "running",
      cpuPct: 5,
      memMb: 68,
      startedAt: Date.now() - 4_000,
      kind: "capture",
    });
  }

  return rows.slice(0, 40);
}

usePacketCaptureStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "packet-capture-store",
    buildPacketCaptureActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "packet-capture-store",
  buildPacketCaptureActivityItems(usePacketCaptureStore.getState()),
);
