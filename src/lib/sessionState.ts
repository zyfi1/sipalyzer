/**
 * Session state persistence backed by the encrypted SQLite database via Tauri IPC.
 *
 * - `loadSessionState()` → single `invoke("pull_session_state")`.
 * - `saveSessionState()` → single `invoke("push_session_state")`.
 *
 * The DB is opened in Rust `.setup()` before the WebView loads, so it is always
 * ready — no retries needed.
 */

import { invokeTauri } from "@/api/invoke";
import { useToolStore } from "@/stores/toolStore";
import { useSidebarStore } from "@/stores/sidebarStore";
import { useNotificationStore, type NotificationSettings } from "@/stores/notificationStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useContactsStore } from "@/stores/contactsStore";
import { useSshStore } from "@/stores/sshStore";
import { usePacketAnnotationStore } from "@/stores/packetAnnotationStore";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { useUiPrefsStore } from "@/stores/uiPrefsStore";
import { useCrafterStore } from "@/stores/crafterStore";
import { useSipDiscoveryStore } from "@/stores/sipDiscoveryStore";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { useRemoteAgentStore, type ActivityLogEntry as RALogEntry, type GeneratedConfig as RAGeneratedConfig } from "@/stores/remoteAgentStore";
import { useTtsStore } from "@/stores/ttsStore";
import { useComposerStore } from "@/stores/composerStore";
import { useHomeStore, DEFAULT_HERO, type HomeMode, type HomePreset, type HomeQuickActionItem, type HomeSectionConfig, type HomeWidgetItem, type HeroConfig } from "@/stores/homeStore";
import { useMcpStore, type McpActivityEntry } from "@/stores/mcpStore";
import type { LayoutItem } from "react-grid-layout";
import { toolRegistry, HOME_TOOL_ID } from "@/lib/toolRegistry";
import type { FaxFolder, ReceivedFax, SentFaxJob } from "@/types/fax";
import type {
  UserAgentSettings,
  FaxSettings,
  PacketMonitorSettings,
  TerminalSettings,
  TimezoneSetting,
  TimeFormatSetting,
  DateFormatSetting,
  TemperatureUnit,
} from "@/stores/settingsStore";
import type { Contact } from "@/stores/contactsStore";
import type { SshConnection, SshHistoryEntry, PortProfile as SshPortProfile } from "@/stores/sshStore";
import type { SpeedDialEntry } from "@/stores/softphoneStore";
import type { Call } from "@/lib/softphone";
import type { PacketAnnotation } from "@/stores/packetAnnotationStore";
import type { PortProfile as NetworkPortProfile } from "@/types/networkTest";
import type { ScanHistoryEntry as SipScanHistoryEntry, ScanMethod as SipScanMethod, ScanTransport as SipScanTransport } from "@/types/sipDiscovery";
import type { ScanHistoryEntry as NetScanHistoryEntry, ScanMethod as NetScanMethod, ScanTransport as NetScanTransport, ScanMode, ScanEnrichmentPreset, DeviceLabelCacheEntry } from "@/types/networkDevices";
import type {
  ComposerCollection,
  ComposerHistoryEntry,
  ComposerEnvironment,
  PortProfile as WbPortProfile,
  ComposerUiPrefs,
} from "@/types/composer";
import type { McpHostedServerState, McpPromptDescriptor, McpResourceDescriptor, McpServerProfile, McpServerStatus, McpToolDescriptor } from "@/api/mcp";


// ---------------------------------------------------------------------------
// Schema (version 4 — finer grid: row height halved, h/y values doubled)
// ---------------------------------------------------------------------------

const SESSION_STATE_VERSION = 17;
const MAX_PERSISTED_CALLS = 200;
const MAX_PERSISTED_TRANSCRIPT_LINES = 300;
const MAX_PERSISTED_SIP_LOG_ENTRIES = 300;
const MAX_PERSISTED_DTMF_ENTRIES = 200;
const MAX_PERSISTED_RAW_SIGNALING_CHARS = 24_000;

export interface SessionStateSchema {
  version: number;
  tool?: {
    activeToolId: string | null;
    activeSubviewId: string | null;
    lastViewedSubviews: Record<string, string>;
  };
  sidebar?: {
    isCollapsed: boolean;
  };
  notification?: {
    settings: NotificationSettings;
  };
  troubleshooting?: {
    receivedFaxes: ReceivedFax[];
    sentFaxJobs?: SentFaxJob[];
    faxFolders?: FaxFolder[];
    faxFolderAssignments?: Record<string, string>;
    timelineClearedAt: string | null;
  };
  settings?: {
    userAgent: UserAgentSettings;
    fax: FaxSettings;
    packetMonitor: PacketMonitorSettings;
    terminal: TerminalSettings;
    timezone: TimezoneSetting;
    timeFormat: TimeFormatSetting;
    dateFormat?: DateFormatSetting;
    temperatureUnit?: TemperatureUnit;
    weatherLocation?: string;
    weatherLat?: number | null;
    weatherLon?: number | null;
    highVisibility?: boolean;
    confirmOnClose?: boolean;
    minimizeToTray?: boolean;
    hideDockIcon?: boolean;
    showTrayIcon?: boolean;
  };
  softphone?: {
    activeRegistrarId: string | null;
    activeCallId?: string | null;
    calls?: Call[];
    watchedRegistrarIds?: string[];
    preferredCodecs: string[];
    preferredCodecsByRegistrar?: Record<string, string[]>;
    jitterBufferMinMs: number;
    jitterBufferMaxMs: number;
    mohPreset: string;
    audioInputDeviceId: string | null;
    audioOutputDeviceId: string | null;
    audioInputLevel?: number;
    audioInputGain?: number;
    speedDialEntries: SpeedDialEntry[];
    callNotes: Record<string, string>;
    visualizer?: string;
    showVisualizer?: boolean;
    dndEnabled?: boolean;
    autoAnswerEnabled?: boolean;
    autoAnswerDelayMs?: number;
    ringtonePreset?: string;
    ringbackEnabled?: boolean;
    callWaitingEnabled?: boolean;
    maxSimultaneousCalls?: number;
    dtmfMode?: string;
    dtmfPayloadType?: number;
    autoRecordEnabled?: boolean;
    recordingFormat?: string;
    recordingStereo?: boolean;
    clickToDialEnabled?: boolean;
    autoOpenOnIncoming?: boolean;
    forwardAllEnabled?: boolean;
    forwardAllTarget?: string;
    forwardBusyEnabled?: boolean;
    forwardBusyTarget?: string;
    forwardNoAnswerEnabled?: boolean;
    forwardNoAnswerTarget?: string;
    forwardNoAnswerTimeout?: number;
    agcEnabled?: boolean;
    vadEnabled?: boolean;
    plcEnabled?: boolean;
    srtpEnabled?: boolean;
    srtpMode?: string;
  };
  contacts?: {
    contacts: Contact[];
  };
  ssh?: {
    connections: SshConnection[];
    history: SshHistoryEntry[];
    portProfiles: SshPortProfile[];
  };
  packetAnnotations?: {
    annotations: Record<string, PacketAnnotation>;
  };
  networkTest?: {
    savedPortProfiles: NetworkPortProfile[];
    voipTarget: string;
    monitorTarget: string;
  };
  uiPrefs?: {
    packetColumnConfigs: Record<string, unknown> | null;
    packetColumnOrder: string[] | null;
    wiresharkFilterHistory: string[];
    cmdPaletteRecent: string[];
    noteCategories: string[];
    noteTags: string[];
  };
  crafter?: {
    sipDraft: import("@/types/crafter").SipRequestDraft;
    httpDraft: import("@/types/crafter").HttpRequestDraft;
    collections: import("@/types/crafter").CrafterCollection;
    history: import("@/types/crafter").CrafterHistoryEntry[];
    activeSubview: "sip" | "http" | "collections" | "history" | "wiki";
    uiPrefs: import("@/types/crafter").CrafterUiPrefs;
  };
  sipDiscovery?: {
    targets: string;
    ports: string;
    transport: SipScanTransport;
    method: SipScanMethod;
    concurrency: number;
    timeoutMs: number;
    history: SipScanHistoryEntry[];
  };
  networkDevices?: {
    targets: string;
    ports: string;
    transport: NetScanTransport;
    method: NetScanMethod;
    scanMode: ScanMode;
    concurrency: number;
    timeoutMs: number;
    enrichmentPreset?: ScanEnrichmentPreset;
    deviceLabelCache?: Record<string, DeviceLabelCacheEntry>;
    history: NetScanHistoryEntry[];
  };
  remoteAgent?: {
    activityLog: RALogEntry[];
    generatedConfigs: RAGeneratedConfig[];
    agentNames?: Record<string, string>;
  };
  tts?: {
    voiceURI: string | null;
    rate: number;
    pitch: number;
    volume: number;
    enabled: boolean;
  };
  composer?: {
    collections: ComposerCollection;
    environments: ComposerEnvironment[];
    activeEnvironmentId: string | null;
    globalVariables: Array<{ key: string; value: string; enabled: boolean }>;
    history: ComposerHistoryEntry[];
    portProfiles: WbPortProfile[];
    uiPrefs: ComposerUiPrefs;
    openTabs: Array<{ itemId: string; dirty: boolean }>;
    activeTabId: string | null;
  };
  home?: {
    sections: HomeSectionConfig[];
    layouts?: LayoutItem[];
    homeQuickActions?: HomeQuickActionItem[];
    homeWidgets?: HomeWidgetItem[];
    hero?: HeroConfig;
    homeMode?: HomeMode;
    homePreset?: HomePreset;
    activityMonitorClearedAt?: number;
    recentActivityClearedAt?: number;
    topPaneOpen?: boolean;
  };
  mcp?: {
    profiles: McpServerProfile[];
    statuses: McpServerStatus[];
    hostedState: McpHostedServerState | null;
    selectedServerId: string | null;
    activity: McpActivityEntry[];
    toolsByServer: Record<string, McpToolDescriptor[]>;
    resourcesByServer: Record<string, McpResourceDescriptor[]>;
    promptsByServer: Record<string, McpPromptDescriptor[]>;
  };
}

export type PersistedSessionSlice = Exclude<keyof SessionStateSchema, "version">;
export const ALL_PERSISTED_SESSION_SLICES: PersistedSessionSlice[] = [
  "tool",
  "sidebar",
  "notification",
  "troubleshooting",
  "settings",
  "softphone",
  "contacts",
  "ssh",
  "packetAnnotations",
  "networkTest",
  "uiPrefs",
  "crafter",
  "sipDiscovery",
  "networkDevices",
  "remoteAgent",
  "tts",
  "composer",
  "home",
  "mcp",
];

function defaultSessionState(): SessionStateSchema {
  return { version: SESSION_STATE_VERSION };
}

function clampSignalText(value: string | undefined): string | undefined {
  if (!value) return value;
  if (value.length <= MAX_PERSISTED_RAW_SIGNALING_CHARS) return value;
  return value.slice(0, MAX_PERSISTED_RAW_SIGNALING_CHARS);
}

/**
 * Normalize calls for persistence so session restore remains stable:
 * - Live/intermediate states are converted to ended when saving (crash-safe history)
 * - Truncate high-volume call fields to keep writes responsive
 * - Keep at most latest 200 calls to bound blob size
 */
function normalizeCallsForSession(calls: Call[]): Call[] {
  const nowIso = new Date().toISOString();
  const normalized = calls.map((call) => {
    const compact: Call = {
      ...call,
      requestMessage: clampSignalText(call.requestMessage),
      responseMessage: clampSignalText(call.responseMessage),
      transcription: (call.transcription ?? []).slice(-MAX_PERSISTED_TRANSCRIPT_LINES),
      sipLog: (call.sipLog ?? []).slice(-MAX_PERSISTED_SIP_LOG_ENTRIES).map((entry) => ({
        ...entry,
        raw: clampSignalText(entry.raw) ?? "",
      })),
      dtmfDigits: (call.dtmfDigits ?? []).slice(-MAX_PERSISTED_DTMF_ENTRIES),
      // Never persist embedded pcap payload inside session state.
      remotePcapBase64: undefined,
    };
    if (call.state === "active" || call.state === "on-hold" || call.state === "ringing" || call.state === "connecting") {
      return {
        ...compact,
        state: "ended" as const,
        endTime: call.endTime ?? nowIso,
        errorMessage: call.errorMessage ?? "Recovered after app restart",
      };
    }
    return compact;
  });
  return normalized.slice(0, MAX_PERSISTED_CALLS);
}

/**
 * Migrate from an older schema version to the current one.
 * v1 → v2: drop layout, packetCapture, registration, notes, provisionViewerData.
 * v2 → v3: add dashboard widget layout.
 * v3 → v4: finer grid (row height 80→40px) — double all widget h & y values.
 * v4 → v5: header + terminal settings moved from localStorage to session state.
 * v5 → v6: ssh, packetAnnotations, networkTest, uiPrefs, softphone extras
 *           (speedDialEntries, callNotes) all moved into session state.
 * v6 → v7: crafter (Request Builder: SIP & HTTP builder, collections, history, wiki).
 * v7 → v8: sipDiscovery (SIP Discovery: scan config, scan history).
 * v8 → v9: networkDevices (Network Devices: expanded from SIP Discovery with scan modes).
 * v9 → v10: voipTools (VoIP Tools: calculators, SIP traceroute, number lookup).
 * v10 → v11: tts (Text-to-Speech engine: voice, rate, pitch, volume, enabled).
 * v12 → v13: (removed — device control feature removed).
 * v13 → v14: (removed — device control feature removed).
 * v14 → v15: home (customizable home page section config).
 * v15 → v17: no additional migration steps.
 */
function migrateSessionState(raw: Record<string, unknown>, fromVersion: number): SessionStateSchema {
  const state: SessionStateSchema = { version: SESSION_STATE_VERSION };

  // Copy forward the slices that still exist
  if (raw.tool != null) {
    const t = raw.tool as SessionStateSchema["tool"];
    state.tool = {
      activeToolId: t?.activeToolId ?? null,
      activeSubviewId: t?.activeSubviewId ?? null,
      lastViewedSubviews: t?.lastViewedSubviews ?? {},
    };
  }
  if (raw.sidebar != null) state.sidebar = raw.sidebar as SessionStateSchema["sidebar"];
  if (raw.notification != null) state.notification = raw.notification as SessionStateSchema["notification"];
  if (raw.troubleshooting != null) state.troubleshooting = raw.troubleshooting as SessionStateSchema["troubleshooting"];
  if (raw.settings != null) state.settings = raw.settings as SessionStateSchema["settings"];
  if (raw.softphone != null) state.softphone = raw.softphone as SessionStateSchema["softphone"];
  if (raw.contacts != null) state.contacts = raw.contacts as SessionStateSchema["contacts"];

  // v4 → v5: header + terminal moved from localStorage into session state.
  // Old sessions won't have these fields — they'll be initialized to defaults
  // in applyStateToStores (header defaults computed after item registry is populated).

  // v5 → v6: new slices — carry forward if present, otherwise defaults.
  // For the new slices, attempt to migrate from localStorage on first run.
  if (raw.ssh != null) state.ssh = raw.ssh as SessionStateSchema["ssh"];
  if (raw.packetAnnotations != null) state.packetAnnotations = raw.packetAnnotations as SessionStateSchema["packetAnnotations"];
  if (raw.networkTest != null) state.networkTest = raw.networkTest as SessionStateSchema["networkTest"];
  if (raw.uiPrefs != null) state.uiPrefs = raw.uiPrefs as SessionStateSchema["uiPrefs"];
  if (raw.crafter != null) state.crafter = raw.crafter as SessionStateSchema["crafter"];

  // One-time migration from localStorage for stores that previously lived there
  if (fromVersion < 6) {
    migrateV5LocalStorageToState(state);
  }

  if (raw.sipDiscovery != null) state.sipDiscovery = raw.sipDiscovery as SessionStateSchema["sipDiscovery"];

  // v6 → v7: initialize crafter section with defaults if not present
  if (fromVersion < 7 && state.crafter == null) {
    state.crafter = {
      sipDraft: {
        method: "OPTIONS",
        uri: "sip:192.168.1.1:5060",
        transport: "UDP",
        headers: [],
        body: "",
        bodyContentType: "application/sdp",
        auth: null,
      },
      httpDraft: {
        method: "GET",
        url: "https://api.example.com/",
        params: [],
        headers: [],
        bodyType: "none",
        bodyJson: "{}",
        bodyForm: [],
        bodyRaw: "",
        bodyRawContentType: "application/json",
        auth: { type: "none" },
      },
      collections: { folders: [], requests: [] },
      history: [],
      activeSubview: "sip",
      uiPrefs: {
        lastSipMethod: "OPTIONS",
        lastHttpMethod: "GET",
        responseTimeoutSec: 10,
      },
    };
  }

  // v7 → v8: initialize sipDiscovery section with defaults if not present
  if (fromVersion < 8 && state.sipDiscovery == null) {
    state.sipDiscovery = {
      targets: "",
      ports: "5060",
      transport: "udp",
      method: "options",
      concurrency: 20,
      timeoutMs: 2000,
      history: [],
    };
  }

  if (raw.networkDevices != null) state.networkDevices = raw.networkDevices as SessionStateSchema["networkDevices"];

  // v8 → v9: initialize networkDevices section, migrating from sipDiscovery if present
  if (fromVersion < 9 && state.networkDevices == null) {
    const sip = state.sipDiscovery;
    state.networkDevices = {
      targets: sip?.targets ?? "",
      ports: sip?.ports ?? "5060",
      transport: (sip?.transport ?? "udp") as NetScanTransport,
      method: (sip?.method ?? "options") as NetScanMethod,
      scanMode: "quick",
      concurrency: sip?.concurrency ?? 20,
      timeoutMs: sip?.timeoutMs ?? 2000,
      enrichmentPreset: "balanced",
      deviceLabelCache: {},
      history: [],
    };
  }

  // v10 → v11: carry forward or initialize TTS settings with defaults
  if (raw.tts != null) {
    state.tts = raw.tts as SessionStateSchema["tts"];
  }
  if (fromVersion < 11 && state.tts == null) {
    state.tts = {
      voiceURI: null,
      rate: 1.0,
      pitch: 1.0,
      volume: 0.8,
      enabled: true,
    };
  }

  // v11 → v12: unified composer — migrate SSH + crafter data into composer slice
  if (raw.composer != null) {
    state.composer = raw.composer as SessionStateSchema["composer"];
  }
  // Backward compat: old persisted data used key "workbench"; copy into state.composer when present
  if (raw.workbench != null && state.composer == null) {
    state.composer = raw.workbench as SessionStateSchema["composer"];
  }
  if (fromVersion < 12 && state.composer == null) {
    state.composer = migrateToComposer(state);
  }

  // Remap old tool IDs so the active tool points to "composer"
  if (fromVersion < 12 && state.tool) {
    if (state.tool.activeToolId === "ssh-helper" || state.tool.activeToolId === "request-crafter" || state.tool.activeToolId === "workbench") {
      state.tool.activeToolId = "composer";
      state.tool.activeSubviewId = "composer";
    }
  }

  // v14 → v15: home section config (new slice, defaults via store)
  if (raw.home != null) state.home = raw.home as SessionStateSchema["home"];
  return state;
}

/**
 * Migrate SSH + crafter data into the unified composer slice.
 * SSH connections become composer items with protocol "ssh",
 * crafter requests/folders carry over, crafter history merges into composer history.
 */
function migrateToComposer(state: SessionStateSchema): SessionStateSchema["composer"] {
  const now = Date.now();
  const items: import("@/types/composer").ComposerItem[] = [];
  const folders: import("@/types/composer").ComposerFolder[] = [];

  // --- Migrate SSH connections ---
  if (state.ssh?.connections) {
    for (const conn of state.ssh.connections) {
      items.push({
        id: conn.id,
        protocol: "ssh",
        name: conn.name || `${conn.username}@${conn.host}`,
        folderId: null,
        notes: "",
        color: "",
        createdAt: conn.createdAt ?? now,
        updatedAt: now,
        sshData: {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          authMethod: conn.authMethod,
          keyFilePath: conn.keyFilePath,
          portForwards: conn.portForwards ?? [],
          advancedOptions: conn.advancedOptions ?? {
            compression: false,
            keepAliveInterval: 60,
            keepAliveCountMax: 3,
            strictHostKeyChecking: "ask",
            jumpHost: "",
            customFlags: "",
            connectionTimeout: 30,
          },
          lastConnected: conn.lastConnected ?? null,
        },
      });
    }
  }

  // --- Migrate crafter folders ---
  if (state.crafter?.collections?.folders) {
    for (const f of state.crafter.collections.folders) {
      folders.push({
        id: f.id,
        name: f.name,
        parentId: f.parentId ?? null,
        order: f.order,
        collapsed: false,
        createdAt: f.createdAt ?? now,
      });
    }
  }

  // --- Migrate crafter saved requests ---
  if (state.crafter?.collections?.requests) {
    for (const req of state.crafter.collections.requests) {
      if (req.protocol === "sip" && req.sipRequest) {
        items.push({
          id: req.id,
          protocol: "sip",
          name: req.name,
          folderId: req.folderId ?? null,
          notes: req.notes ?? "",
          color: req.color ?? "",
          createdAt: req.createdAt ?? now,
          updatedAt: req.updatedAt ?? now,
          sipData: req.sipRequest,
        });
      } else if (req.protocol === "http" && req.httpRequest) {
        items.push({
          id: req.id,
          protocol: "http",
          name: req.name,
          folderId: req.folderId ?? null,
          notes: req.notes ?? "",
          color: req.color ?? "",
          createdAt: req.createdAt ?? now,
          updatedAt: req.updatedAt ?? now,
          httpData: req.httpRequest,
        });
      }
    }
  }

  // --- Migrate histories ---
  const history: import("@/types/composer").ComposerHistoryEntry[] = [];

  // SSH history
  if (state.ssh?.history) {
    for (const h of state.ssh.history) {
      history.push({
        id: h.id,
        protocol: "ssh",
        method: "SSH connect",
        target: `${h.username}@${h.host}`,
        timestamp: h.timestamp,
        itemId: h.connectionId ?? undefined,
      });
    }
  }

  // Crafter history
  if (state.crafter?.history) {
    for (const h of state.crafter.history) {
      history.push({
        id: h.id,
        protocol: h.protocol === "sip" ? "sip" : "http",
        method: h.method,
        target: h.target,
        statusCode: h.statusCode,
        roundTripMs: h.roundTripMs,
        timestamp: h.timestamp,
        requestPreview: h.requestPreview,
        responsePreview: h.responsePreview,
      });
    }
  }

  // Sort history by timestamp descending, cap at 500
  history.sort((a, b) => b.timestamp - a.timestamp);
  const cappedHistory = history.slice(0, 500);

  // --- Migrate port profiles ---
  const portProfiles: import("@/types/composer").PortProfile[] = (state.ssh?.portProfiles ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    rules: p.rules ?? [],
    createdAt: p.createdAt ?? now,
  }));

  return {
    collections: { folders, items },
    environments: [],
    activeEnvironmentId: null,
    globalVariables: [],
    history: cappedHistory,
    portProfiles,
    uiPrefs: {
      sidebarWidth: 260,
      splitPercent: state.crafter?.uiPrefs?.splitPercent ?? 50,
      lastSipMethod: state.crafter?.uiPrefs?.lastSipMethod ?? "OPTIONS",
      lastHttpMethod: state.crafter?.uiPrefs?.lastHttpMethod ?? "GET",
      responseTimeoutSec: state.crafter?.uiPrefs?.responseTimeoutSec ?? 10,
      wizardDismissed: state.crafter?.uiPrefs?.wizardDismissed ?? false,
    },
    openTabs: [],
    activeTabId: null,
  };
}

/**
 * One-time: pull data from localStorage that was previously owned by
 * sshStore, packetAnnotationStore, and scattered UI components.
 * After pulling, the localStorage keys are removed.
 */
function migrateV5LocalStorageToState(state: SessionStateSchema): void {
  try {
    // SSH store
    const sshConns = tryParseLocalStorage<SshConnection[]>("sipalyzer:ssh-connections");
    const sshHistory = tryParseLocalStorage<SshHistoryEntry[]>("sipalyzer:ssh-history");
    const sshProfiles = tryParseLocalStorage<SshPortProfile[]>("sipalyzer:ssh-port-profiles");
    if (sshConns || sshHistory || sshProfiles) {
      state.ssh = {
        connections: sshConns ?? [],
        history: sshHistory ?? [],
        portProfiles: sshProfiles ?? [],
      };
    }

    // Packet annotations (zustand persist key)
    const annotRaw = tryParseLocalStorage<{ state?: { annotations?: Record<string, PacketAnnotation> } }>("packet-annotations");
    if (annotRaw?.state?.annotations) {
      state.packetAnnotations = { annotations: annotRaw.state.annotations };
    }

    // UI prefs
    const colConfigs = tryParseLocalStorage<Record<string, unknown>>("packet-list-column-configs");
    const colOrder = tryParseLocalStorage<string[]>("packet-list-column-order");
    const filterHist = tryParseLocalStorage<string[]>("wireshark-filter-history");
    const paletteRecent = tryParseLocalStorage<string[]>("sipalyzer-cmd-palette-recent");
    const noteCats = tryParseLocalStorage<string[]>("notes-available-categories");
    const noteTags = tryParseLocalStorage<string[]>("notes-available-tags");
    if (colConfigs || colOrder || filterHist || paletteRecent || noteCats || noteTags) {
      state.uiPrefs = {
        packetColumnConfigs: colConfigs ?? null,
        packetColumnOrder: colOrder ?? null,
        wiresharkFilterHistory: filterHist ?? [],
        cmdPaletteRecent: paletteRecent ?? [],
        noteCategories: noteCats ?? [],
        noteTags: noteTags ?? [],
      };
    }

    // Clean up migrated keys
    const keysToRemove = [
      "sipalyzer:ssh-connections", "sipalyzer:ssh-history", "sipalyzer:ssh-port-profiles",
      "packet-annotations",
      "packet-list-column-configs", "packet-list-column-order",
      "wireshark-filter-history", "sipalyzer-cmd-palette-recent",
      "notes-available-categories", "notes-available-tags",
    ];
    for (const k of keysToRemove) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  } catch {
    /* migration is best-effort */
  }
}

function tryParseLocalStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load session state from the database (single IPC call).
 * Falls back to empty defaults if nothing is stored yet.
 */
export async function loadSessionState(): Promise<SessionStateSchema> {
  // Clean up legacy localStorage persistence (settings now in encrypted SQLite only).
  try { localStorage.removeItem("app-settings"); } catch { /* ignore */ }
  try { localStorage.removeItem("sipalyzer-settings"); } catch { /* ignore */ }

  try {
    const raw = await invokeTauri<string | null>("pull_session_state");
    if (raw == null || typeof raw !== "string" || !raw.trim()) {
      return defaultSessionState();
    }
    const parsed = JSON.parse(raw) as { version?: number; [key: string]: unknown };
    const version = typeof parsed.version === "number" ? parsed.version : 0;
    if (version === SESSION_STATE_VERSION) return parsed as SessionStateSchema;
    return migrateSessionState(parsed, version);
  } catch {
    return defaultSessionState();
  }
}

/**
 * Write session state to the database (single ACID IPC call).
 */
export async function saveSessionState(state: SessionStateSchema): Promise<void> {
  const json = JSON.stringify(state);
  await invokeTauri("push_session_state", { json });
}

// ---------------------------------------------------------------------------
// Collect / Apply helpers
// ---------------------------------------------------------------------------

/** Collect current state from all stores into the persisted blob. */
export function collectStateFromStores(): SessionStateSchema {
  const composed = collectStateSlicesFromStores(ALL_PERSISTED_SESSION_SLICES);
  return {
    version: SESSION_STATE_VERSION,
    ...composed,
  };
}

/** Collect only selected persisted slices from stores. */
export function collectStateSlicesFromStores(
  slices: Iterable<PersistedSessionSlice>,
): Partial<SessionStateSchema> {
  const tool = useToolStore.getState();
  const sidebar = useSidebarStore.getState();
  const notification = useNotificationStore.getState();
  const troubleshooting = useTroubleshootingStore.getState();
  const settings = useSettingsStore.getState();
  const softphone = useSoftphoneStore.getState();
  const contacts = useContactsStore.getState();
  const ssh = useSshStore.getState();
  const annotations = usePacketAnnotationStore.getState();
  const networkTest = useNetworkTestStore.getState();
  const uiPrefs = useUiPrefsStore.getState();
  const crafter = useCrafterStore.getState();
  const sipDiscovery = useSipDiscoveryStore.getState();
  const networkDevices = useNetworkDevicesStore.getState();
  const remoteAgent = useRemoteAgentStore.getState();
  const tts = useTtsStore.getState();
  const mcp = useMcpStore.getState();
  const home = useHomeStore.getState();
  // Cap annotations to 50k entries to keep the blob manageable
  let annotationData = annotations.annotations;
  const annotEntries = Object.entries(annotationData);
  if (annotEntries.length > 50_000) {
    annotationData = Object.fromEntries(annotEntries.slice(-50_000));
  }

  const composed: Partial<SessionStateSchema> = {};
  for (const slice of slices) {
    switch (slice) {
      case "tool":
        composed.tool = {
          activeToolId: tool.activeToolId,
          activeSubviewId: tool.activeSubviewId,
          lastViewedSubviews: tool.lastViewedSubviews,
        };
        break;
      case "sidebar":
        composed.sidebar = { isCollapsed: sidebar.isCollapsed };
        break;
      case "notification":
        composed.notification = { settings: notification.settings };
        break;
      case "troubleshooting":
        composed.troubleshooting = {
          receivedFaxes: troubleshooting.receivedFaxes ?? [],
          sentFaxJobs: troubleshooting.sentFaxJobs ?? [],
          faxFolders: troubleshooting.faxFolders ?? [],
          faxFolderAssignments: troubleshooting.faxFolderAssignments ?? {},
          timelineClearedAt: troubleshooting.timelineClearedAt,
        };
        break;
      case "settings":
        composed.settings = {
          userAgent: settings.userAgent,
          fax: settings.fax,
          packetMonitor: settings.packetMonitor,
          terminal: settings.terminal,
          timezone: settings.timezone,
          timeFormat: settings.timeFormat,
          dateFormat: settings.dateFormat,
          temperatureUnit: settings.temperatureUnit,
          weatherLocation: settings.weatherLocation,
          weatherLat: settings.weatherLat,
          weatherLon: settings.weatherLon,
          highVisibility: settings.highVisibility,
          confirmOnClose: settings.confirmOnClose,
          minimizeToTray: settings.minimizeToTray,
          hideDockIcon: settings.hideDockIcon,
          showTrayIcon: settings.showTrayIcon,
        };
        break;
      case "softphone":
        const persistedCalls = normalizeCallsForSession(softphone.calls ?? []);
        composed.softphone = {
          activeRegistrarId: softphone.activeRegistrarId,
          activeCallId: softphone.activeCallId,
          calls: persistedCalls,
          watchedRegistrarIds: softphone.watchedRegistrarIds ?? [],
          preferredCodecs: softphone.preferredCodecs,
          preferredCodecsByRegistrar: softphone.preferredCodecsByRegistrar,
          jitterBufferMinMs: softphone.jitterBufferMinMs,
          jitterBufferMaxMs: softphone.jitterBufferMaxMs,
          mohPreset: softphone.mohPreset,
          audioInputDeviceId: softphone.audioInputDeviceId,
          audioOutputDeviceId: softphone.audioOutputDeviceId,
          audioInputLevel: softphone.audioInputLevel,
          speedDialEntries: softphone.speedDialEntries ?? [],
          callNotes: softphone.callNotes ?? {},
          visualizer: softphone.visualizer,
          showVisualizer: softphone.showVisualizer,
          dndEnabled: softphone.dndEnabled,
          autoAnswerEnabled: softphone.autoAnswerEnabled,
          autoAnswerDelayMs: softphone.autoAnswerDelayMs,
          ringtonePreset: softphone.ringtonePreset,
          ringbackEnabled: softphone.ringbackEnabled,
          callWaitingEnabled: softphone.callWaitingEnabled,
          maxSimultaneousCalls: softphone.maxSimultaneousCalls,
          dtmfMode: softphone.dtmfMode,
          dtmfPayloadType: softphone.dtmfPayloadType,
          autoRecordEnabled: softphone.autoRecordEnabled,
          recordingFormat: softphone.recordingFormat,
          recordingStereo: softphone.recordingStereo,
          clickToDialEnabled: softphone.clickToDialEnabled,
          autoOpenOnIncoming: softphone.autoOpenOnIncoming,
          forwardAllEnabled: softphone.forwardAllEnabled,
          forwardAllTarget: softphone.forwardAllTarget,
          forwardBusyEnabled: softphone.forwardBusyEnabled,
          forwardBusyTarget: softphone.forwardBusyTarget,
          forwardNoAnswerEnabled: softphone.forwardNoAnswerEnabled,
          forwardNoAnswerTarget: softphone.forwardNoAnswerTarget,
          forwardNoAnswerTimeout: softphone.forwardNoAnswerTimeout,
          agcEnabled: softphone.agcEnabled,
          vadEnabled: softphone.vadEnabled,
          plcEnabled: softphone.plcEnabled,
          srtpEnabled: softphone.srtpEnabled,
          srtpMode: softphone.srtpMode,
        };
        break;
      case "contacts":
        composed.contacts = { contacts: contacts.contacts };
        break;
      case "ssh":
        composed.ssh = {
          connections: ssh.connections,
          history: ssh.history,
          portProfiles: ssh.portProfiles,
        };
        break;
      case "packetAnnotations":
        composed.packetAnnotations = { annotations: annotationData };
        break;
      case "networkTest":
        composed.networkTest = {
          savedPortProfiles: networkTest.savedPortProfiles,
          voipTarget: networkTest.voipTarget,
          monitorTarget: networkTest.monitorTarget,
        };
        break;
      case "uiPrefs":
        composed.uiPrefs = {
          packetColumnConfigs: uiPrefs.packetColumnConfigs,
          packetColumnOrder: uiPrefs.packetColumnOrder,
          wiresharkFilterHistory: uiPrefs.wiresharkFilterHistory,
          cmdPaletteRecent: uiPrefs.cmdPaletteRecent,
          noteCategories: uiPrefs.noteCategories,
          noteTags: uiPrefs.noteTags,
        };
        break;
      case "crafter":
        composed.crafter = {
          sipDraft: crafter.sipDraft,
          httpDraft: crafter.httpDraft,
          collections: crafter.collections,
          history: crafter.history,
          activeSubview: crafter.activeSubview,
          uiPrefs: crafter.uiPrefs,
        };
        break;
      case "sipDiscovery":
        composed.sipDiscovery = {
          targets: sipDiscovery.targets,
          ports: sipDiscovery.ports,
          transport: sipDiscovery.transport,
          method: sipDiscovery.method,
          concurrency: sipDiscovery.concurrency,
          timeoutMs: sipDiscovery.timeoutMs,
          history: sipDiscovery.history.slice(0, 20),
        };
        break;
      case "networkDevices":
        composed.networkDevices = {
          targets: networkDevices.targets,
          ports: networkDevices.ports,
          transport: networkDevices.transport,
          method: networkDevices.method,
          scanMode: networkDevices.scanMode,
          concurrency: networkDevices.concurrency,
          timeoutMs: networkDevices.timeoutMs,
          enrichmentPreset: networkDevices.enrichmentPreset,
          deviceLabelCache: networkDevices.deviceLabelCache,
          history: networkDevices.history.slice(0, 20),
        };
        break;
      case "remoteAgent":
        composed.remoteAgent = {
          activityLog: remoteAgent.activityLog.slice(0, 200),
          generatedConfigs: remoteAgent.generatedConfigs.slice(0, 50),
          agentNames: remoteAgent.agentNames ?? {},
        };
        break;
      case "tts":
        composed.tts = {
          voiceURI: tts.voiceURI,
          rate: tts.rate,
          pitch: tts.pitch,
          volume: tts.volume,
          enabled: tts.enabled,
        };
        break;
      case "composer": {
        const wb = useComposerStore.getState();
        composed.composer = {
          collections: wb.collections,
          environments: wb.environments,
          activeEnvironmentId: wb.activeEnvironmentId,
          globalVariables: wb.globalVariables,
          history: wb.history.slice(0, 500),
          portProfiles: wb.portProfiles,
          uiPrefs: wb.uiPrefs,
          openTabs: wb.openTabs,
          activeTabId: wb.activeTabId,
        };
        break;
      }
      case "home":
        composed.home = {
          sections: home.sections,
          layouts: home.layouts,
          homeQuickActions: home.homeQuickActions,
          homeWidgets: home.homeWidgets,
          hero: home.hero,
          homeMode: home.homeMode,
          homePreset: home.homePreset,
          activityMonitorClearedAt: home.activityMonitorClearedAt,
          recentActivityClearedAt: home.recentActivityClearedAt,
          topPaneOpen: home.topPaneOpen,
        };
        break;
      case "mcp":
        composed.mcp = {
          profiles: mcp.profiles,
          statuses: mcp.statuses,
          hostedState: mcp.hostedState,
          selectedServerId: mcp.selectedServerId,
          activity: mcp.activity.slice(0, 300),
          toolsByServer: mcp.toolsByServer,
          resourcesByServer: mcp.resourcesByServer,
          promptsByServer: mcp.promptsByServer,
        };
        break;
    }
  }
  return composed;
}

export function mergeSessionState(
  base: SessionStateSchema,
  patch: Partial<SessionStateSchema>,
): SessionStateSchema {
  return {
    ...base,
    ...patch,
    version: SESSION_STATE_VERSION,
  };
}

/** Apply loaded state to all stores. */
export function applyStateToStores(state: SessionStateSchema): void {
  if (state.tool) {
    const { activeToolId, activeSubviewId, lastViewedSubviews } = state.tool;
    const validToolId =
      activeToolId != null && toolRegistry.get(activeToolId) ? activeToolId : HOME_TOOL_ID;
    useToolStore.getState().setActiveTool(validToolId, activeSubviewId ?? undefined);
    if (lastViewedSubviews && Object.keys(lastViewedSubviews).length > 0) {
      useToolStore.setState((s) => ({
        lastViewedSubviews: { ...s.lastViewedSubviews, ...lastViewedSubviews },
      }));
    }
  }

  if (state.sidebar) {
    useSidebarStore.getState().setCollapsed(state.sidebar.isCollapsed);
  }

  if (state.notification?.settings) {
    // Merge with current defaults so new settings fields (added in updates) get defaults
    const current = useNotificationStore.getState().settings;
    useNotificationStore.setState({ settings: { ...current, ...state.notification.settings } });
  }

  if (state.troubleshooting) {
    useTroubleshootingStore.setState({
      receivedFaxes: state.troubleshooting.receivedFaxes ?? [],
      sentFaxJobs: state.troubleshooting.sentFaxJobs ?? [],
      faxFolders: state.troubleshooting.faxFolders ?? useTroubleshootingStore.getState().faxFolders,
      faxFolderAssignments: state.troubleshooting.faxFolderAssignments ?? {},
      timelineClearedAt: state.troubleshooting.timelineClearedAt ?? null,
    });
  }

  if (state.settings) {
    // Strip stale header config from old session states (header is now static)
    const { header: _header, ...rest } = state.settings as Record<string, unknown>;
    useSettingsStore.setState(rest);
    if (state.settings.weatherLat !== undefined) useSettingsStore.setState({ weatherLat: state.settings.weatherLat });
    if (state.settings.weatherLon !== undefined) useSettingsStore.setState({ weatherLon: state.settings.weatherLon });
  }

  if (state.softphone) {
    const sp = state.softphone;
    const codecMap = sp.preferredCodecsByRegistrar ?? { __default__: sp.preferredCodecs ?? [] };
    const activeCodecKey = sp.activeRegistrarId ?? "__default__";
    const activeCodecs =
      codecMap[activeCodecKey] && codecMap[activeCodecKey]!.length > 0
        ? codecMap[activeCodecKey]!
        : sp.preferredCodecs ?? [];
    useSoftphoneStore.setState({
      activeRegistrarId: sp.activeRegistrarId,
      activeCallId: sp.activeCallId ?? null,
      calls: (sp.calls ?? []).map((call) => {
        if (call.state === "active" || call.state === "on-hold" || call.state === "ringing" || call.state === "connecting") {
          return {
            ...call,
            state: "ended" as const,
            endTime: call.endTime ?? new Date().toISOString(),
            errorMessage: call.errorMessage ?? "Recovered after app restart",
          };
        }
        return call;
      }),
      watchedRegistrarIds: sp.watchedRegistrarIds ?? [],
      preferredCodecs: activeCodecs,
      preferredCodecsByRegistrar: codecMap,
      jitterBufferMinMs: sp.jitterBufferMinMs,
      jitterBufferMaxMs: sp.jitterBufferMaxMs,
      mohPreset: sp.mohPreset ?? "system",
      audioInputDeviceId: sp.audioInputDeviceId ?? null,
      audioOutputDeviceId: sp.audioOutputDeviceId ?? null,
      audioInputLevel: sp.audioInputLevel ?? sp.audioInputGain ?? 1.0,
      speedDialEntries: sp.speedDialEntries ?? [],
      callNotes: sp.callNotes ?? {},
      ...(sp.visualizer != null && { visualizer: sp.visualizer as "nebula" | "ribbon" | "aurora" | "ekg" | "terrain" | "bars" | "rain" }),
      ...(sp.showVisualizer != null && { showVisualizer: sp.showVisualizer }),
      ...(sp.dndEnabled != null && { dndEnabled: sp.dndEnabled }),
      ...(sp.autoAnswerEnabled != null && { autoAnswerEnabled: sp.autoAnswerEnabled }),
      ...(sp.autoAnswerDelayMs != null && { autoAnswerDelayMs: sp.autoAnswerDelayMs }),
      ...(sp.ringtonePreset != null && { ringtonePreset: sp.ringtonePreset }),
      ...(sp.ringbackEnabled != null && { ringbackEnabled: sp.ringbackEnabled }),
      ...(sp.callWaitingEnabled != null && { callWaitingEnabled: sp.callWaitingEnabled }),
      ...(sp.maxSimultaneousCalls != null && { maxSimultaneousCalls: sp.maxSimultaneousCalls }),
      ...(sp.dtmfMode != null && { dtmfMode: sp.dtmfMode as "rfc2833" | "sip-info" }),
      ...(sp.dtmfPayloadType != null && { dtmfPayloadType: sp.dtmfPayloadType }),
      ...(sp.autoRecordEnabled != null && { autoRecordEnabled: sp.autoRecordEnabled }),
      ...(sp.recordingFormat != null && { recordingFormat: sp.recordingFormat as "wav" }),
      ...(sp.recordingStereo != null && { recordingStereo: sp.recordingStereo }),
      ...(sp.clickToDialEnabled != null && { clickToDialEnabled: sp.clickToDialEnabled }),
      ...(sp.autoOpenOnIncoming != null && { autoOpenOnIncoming: sp.autoOpenOnIncoming }),
      ...(sp.forwardAllEnabled != null && { forwardAllEnabled: sp.forwardAllEnabled }),
      ...(sp.forwardAllTarget != null && { forwardAllTarget: sp.forwardAllTarget }),
      ...(sp.forwardBusyEnabled != null && { forwardBusyEnabled: sp.forwardBusyEnabled }),
      ...(sp.forwardBusyTarget != null && { forwardBusyTarget: sp.forwardBusyTarget }),
      ...(sp.forwardNoAnswerEnabled != null && { forwardNoAnswerEnabled: sp.forwardNoAnswerEnabled }),
      ...(sp.forwardNoAnswerTarget != null && { forwardNoAnswerTarget: sp.forwardNoAnswerTarget }),
      ...(sp.forwardNoAnswerTimeout != null && { forwardNoAnswerTimeout: sp.forwardNoAnswerTimeout }),
      ...(sp.agcEnabled != null && { agcEnabled: sp.agcEnabled }),
      ...(sp.vadEnabled != null && { vadEnabled: sp.vadEnabled }),
      ...(sp.plcEnabled != null && { plcEnabled: sp.plcEnabled }),
      ...(sp.srtpEnabled != null && { srtpEnabled: sp.srtpEnabled }),
      ...(sp.srtpMode != null && { srtpMode: sp.srtpMode as "disabled" | "optional" | "mandatory" }),
    });
  }

  if (state.contacts?.contacts) {
    useContactsStore.setState({ contacts: state.contacts.contacts });
  }

  if (state.ssh) {
    useSshStore.setState({
      connections: state.ssh.connections ?? [],
      history: state.ssh.history ?? [],
      portProfiles: state.ssh.portProfiles ?? [],
    });
  }

  if (state.packetAnnotations?.annotations) {
    usePacketAnnotationStore.setState({ annotations: state.packetAnnotations.annotations });
  }

  if (state.networkTest) {
    useNetworkTestStore.setState({
      savedPortProfiles: state.networkTest.savedPortProfiles ?? [],
      voipTarget: state.networkTest.voipTarget ?? "",
      monitorTarget: state.networkTest.monitorTarget ?? "8.8.8.8",
    });
  }

  if (state.uiPrefs) {
    useUiPrefsStore.setState({
      packetColumnConfigs: state.uiPrefs.packetColumnConfigs ?? null,
      packetColumnOrder: state.uiPrefs.packetColumnOrder ?? null,
      wiresharkFilterHistory: state.uiPrefs.wiresharkFilterHistory ?? [],
      cmdPaletteRecent: state.uiPrefs.cmdPaletteRecent ?? [],
      noteCategories: state.uiPrefs.noteCategories ?? [],
      noteTags: state.uiPrefs.noteTags ?? [],
    });
  }

  if (state.crafter) {
    useCrafterStore.setState({
      sipDraft: state.crafter.sipDraft ?? useCrafterStore.getState().sipDraft,
      httpDraft: state.crafter.httpDraft ?? useCrafterStore.getState().httpDraft,
      collections: state.crafter.collections ?? { folders: [], requests: [] },
      history: state.crafter.history ?? [],
      activeSubview: state.crafter.activeSubview ?? "sip",
      uiPrefs: {
        ...useCrafterStore.getState().uiPrefs,
        ...state.crafter.uiPrefs,
      },
    });
  }

  if (state.sipDiscovery) {
    useSipDiscoveryStore.setState({
      targets: state.sipDiscovery.targets ?? "",
      ports: state.sipDiscovery.ports ?? "5060",
      transport: state.sipDiscovery.transport ?? "udp",
      method: state.sipDiscovery.method ?? "options",
      concurrency: state.sipDiscovery.concurrency ?? 20,
      timeoutMs: state.sipDiscovery.timeoutMs ?? 2000,
      history: state.sipDiscovery.history ?? [],
    });
  }

  if (state.networkDevices) {
    useNetworkDevicesStore.setState({
      targets: state.networkDevices.targets ?? "",
      ports: state.networkDevices.ports ?? "5060",
      transport: state.networkDevices.transport ?? "udp",
      method: state.networkDevices.method ?? "options",
      scanMode: state.networkDevices.scanMode ?? "quick",
      concurrency: state.networkDevices.concurrency ?? 20,
      timeoutMs: state.networkDevices.timeoutMs ?? 2000,
      enrichmentPreset: state.networkDevices.enrichmentPreset ?? "balanced",
      deviceLabelCache: state.networkDevices.deviceLabelCache ?? {},
      history: state.networkDevices.history ?? [],
    });
  }

  if (state.remoteAgent) {
    useRemoteAgentStore.setState({
      activityLog: state.remoteAgent.activityLog ?? [],
      generatedConfigs: state.remoteAgent.generatedConfigs ?? [],
      agentNames: state.remoteAgent.agentNames ?? {},
    });
  }

  if (state.tts) {
    useTtsStore.setState({
      voiceURI: state.tts.voiceURI ?? null,
      rate: state.tts.rate ?? 1.0,
      pitch: state.tts.pitch ?? 1.0,
      volume: state.tts.volume ?? 0.8,
      enabled: state.tts.enabled ?? true,
    });
  }

  if (state.composer) {
    const defaultUiPrefs = {
      sidebarWidth: 260,
      splitPercent: 50,
      lastSipMethod: "OPTIONS",
      lastHttpMethod: "GET",
      responseTimeoutSec: 10,
      wizardDismissed: false,
    };
    useComposerStore.setState({
      collections: state.composer.collections ?? { folders: [], items: [] },
      environments: state.composer.environments ?? [],
      activeEnvironmentId: state.composer.activeEnvironmentId ?? null,
      globalVariables: state.composer.globalVariables ?? [],
      history: state.composer.history ?? [],
      portProfiles: state.composer.portProfiles ?? [],
      uiPrefs: { ...defaultUiPrefs, ...state.composer.uiPrefs },
      openTabs: state.composer.openTabs ?? [],
      activeTabId: state.composer.activeTabId ?? null,
    });
  }

  if (state.home) {
    const patch: Partial<{
      sections: HomeSectionConfig[];
      layouts: LayoutItem[];
      homeQuickActions: HomeQuickActionItem[];
      homeWidgets: HomeWidgetItem[];
      hero: HeroConfig;
      homeMode: HomeMode;
      homePreset: HomePreset;
      activityMonitorClearedAt: number;
      recentActivityClearedAt: number;
      topPaneOpen: boolean;
    }> = {};
    if (state.home.sections) patch.sections = state.home.sections;
    if (state.home.layouts) patch.layouts = state.home.layouts;
    if (state.home.homeQuickActions) patch.homeQuickActions = state.home.homeQuickActions;
    if (state.home.homeWidgets) patch.homeWidgets = state.home.homeWidgets;
    if (state.home.hero) patch.hero = { ...DEFAULT_HERO, ...state.home.hero };
    if (state.home.homeMode === "hero" || state.home.homeMode === "dashboard") {
      patch.homeMode = state.home.homeMode;
    }
    if (
      state.home.homePreset === "focus" ||
      state.home.homePreset === "operations" ||
      state.home.homePreset === "monitoring"
    ) {
      patch.homePreset = state.home.homePreset;
    }
    if (typeof state.home.activityMonitorClearedAt === "number") {
      patch.activityMonitorClearedAt = state.home.activityMonitorClearedAt;
      patch.recentActivityClearedAt = state.home.activityMonitorClearedAt;
    } else if (typeof state.home.recentActivityClearedAt === "number") {
      patch.activityMonitorClearedAt = state.home.recentActivityClearedAt;
      patch.recentActivityClearedAt = state.home.recentActivityClearedAt;
    }
    if (typeof state.home.topPaneOpen === "boolean") {
      patch.topPaneOpen = state.home.topPaneOpen;
    }
    if (Object.keys(patch).length > 0) {
      useHomeStore.setState(patch);
    }
    useHomeStore.getState().syncHomeQuickActions();
    if (state.home.homeWidgets) {
      useHomeStore.getState().setHomeWidgets(state.home.homeWidgets);
    }
  }

  if (state.mcp) {
    useMcpStore.setState({
      profiles: state.mcp.profiles ?? [],
      statuses: state.mcp.statuses ?? [],
      hostedState: state.mcp.hostedState ?? null,
      selectedServerId: state.mcp.selectedServerId ?? null,
      activity: state.mcp.activity ?? [],
      toolsByServer: state.mcp.toolsByServer ?? {},
      resourcesByServer: state.mcp.resourcesByServer ?? {},
      promptsByServer: state.mcp.promptsByServer ?? {},
    });
  }

}
