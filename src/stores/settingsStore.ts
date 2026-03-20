import { create } from "zustand";
import { invokeTauri } from "@/api/invoke";
import { DEFAULT_RELEASE_CHANNEL, type ReleaseChannel } from "@/lib/updater/channels";

export type UserAgentPreset = "default" | "info" | "minimal" | "custom";
export type UserAgentScope = "composerHttp" | "composerGraphql" | "composerSip" | "provisionFetch";

export type UserAgentScopeOverrides = Record<UserAgentScope, string>;

export interface UserAgentSettings {
  preset: UserAgentPreset;
  customValue: string;
  overrides: UserAgentScopeOverrides;
}

/** Fax resolution (T.30): standard 204×98 lpi or fine 204×196 lpi. */
export type FaxResolution = "standard" | "fine";

/** Fax settings for both send and receive (T.30 / T.38). Stored in Settings → Fax. */
export interface FaxSettings {
  /** Error Correction Mode — used for send and advertised for receive. */
  ecm: boolean;
  /** When true, do not send T.38 re-INVITE; send fax over G.711 RTP only (m=audio pass-through). */
  useG711Only: boolean;
  /** Default / max baud rate (2400–14400). Used for send and max we support on receive. */
  baudRate: number;
  /** Page resolution: standard or fine. */
  resolution: FaxResolution;
  /** Send: max retries on T.30 failure (1–5). */
  sendRetries: number;
  /** Receive: how long to wait for T.38 data before giving up (seconds). */
  receiveTimeoutSecs: number;
  /** Send: how long to wait for DIS from receiver (seconds). */
  disTimeoutSecs: number;
  /** Send: how long to wait for MCF after sending a page (seconds). */
  mcfTimeoutSecs: number;
  /** Receive: auto-answer after N rings (0 = manual only, 1–5). */
  autoAnswerRings: number;
  /** Receive: save incoming faxes to folder (empty = app only / store in app). */
  saveReceivedToFolder: string;
  /** Station ID (TSI/CSI) — shown on remote fax machine, max 20 chars. */
  stationId: string;
}

/** Packet Monitor settings. Stored in Settings → Packet Monitor. */
export interface PacketMonitorSettings {
  /** Use multi-threaded pipeline capture (100k+ pps) instead of single-threaded. */
  pipelineMode: boolean;
  /** Auto-scroll packet list to newest packets during live capture. */
  autoScroll: boolean;
  /** Ring buffer capacity — max packets held in memory per session. */
  ringBufferCapacity: number;
  /** Max capture sessions kept in memory before oldest are evicted. */
  maxSessionsInMemory: number;
  /** Seconds before a stopped session is evicted from memory. */
  sessionTimeoutSecs: number;
  /** Interval (ms) for polling live packet data from backend. */
  packetPollIntervalMs: number;
  /** Interval (ms) for polling live statistics from backend. */
  statsPollIntervalMs: number;
  /** Number of packets to fetch per page/batch. */
  pageSize: number;
  /** Max packets held in the live stream buffer. */
  streamMaxPackets: number;
  /** Pipeline: raw packet queue capacity. */
  pipelineRawQueueSize: number;
  /** Pipeline: parsed packet queue capacity. */
  pipelineParsedQueueSize: number;
  /** Pipeline: number of parser threads (0 = auto-detect CPU cores). */
  pipelineParserThreads: number;
  /** Pipeline: batch size for PCAP writes. */
  pipelineWriteBatchSize: number;
  /** RTP port range lower bound (for RTP stream detection). */
  rtpPortRangeLow: number;
  /** RTP port range upper bound. */
  rtpPortRangeHigh: number;
}

/** Terminal emulator cursor style. */
export type TerminalCursorStyle = "bar" | "block" | "underline";

/** Terminal emulator settings. Stored in Settings → Terminal. */
export interface TerminalSettings {
  /** Font size in pixels. */
  fontSize: number;
  /** Font family string for xterm.js. */
  fontFamily: string;
  /** Line height multiplier (1.0 – 2.0). */
  lineHeight: number;
  /** Cursor style: bar, block, or underline. */
  cursorStyle: TerminalCursorStyle;
  /** Whether the cursor blinks. */
  cursorBlink: boolean;
  /** Scrollback buffer size (number of lines). */
  scrollback: number;
  /** Confirm before closing the terminal (kills all sessions). */
  confirmOnClose: boolean;
}

/** RTP / UDPTL port allocation range for softphone and fax media. Stored in Settings → Network. */
export interface MediaPortSettings {
  /** Inclusive lower bound (even port). */
  rangeLow: number;
  /** Inclusive upper bound. */
  rangeHigh: number;
}

/** IANA timezone (e.g. "America/New_York") or "" for system local. Stored in Settings → General. */
export type TimezoneSetting = string;

/** Time display: 12-hour (AM/PM) or 24-hour. Stored in Settings → General. */
export type TimeFormatSetting = "12h" | "24h";

/** Date display format. Stored in Settings → General. */
export type DateFormatSetting = "system" | "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" | "DD.MM.YYYY";

/** Temperature unit. Stored in Settings → General. */
export type TemperatureUnit = "celsius" | "fahrenheit";

/** App update channel/preferences. Stored in Settings → General. */
export interface UpdateSettings {
  channel: ReleaseChannel;
  autoCheckOnLaunch: boolean;
}

export interface AppSettingsState {
  userAgent: UserAgentSettings;
  fax: FaxSettings;
  packetMonitor: PacketMonitorSettings;
  terminal: TerminalSettings;
  /** RTP / UDPTL port allocation range. */
  mediaPorts: MediaPortSettings;
  /** IANA timezone or "" for system local. Used app-wide for all timestamp display. */
  timezone: TimezoneSetting;
  /** 12h = AM/PM, 24h = 24-hour. Used app-wide for all time display. */
  timeFormat: TimeFormatSetting;
  /** Date display format. */
  dateFormat: DateFormatSetting;
  /** Temperature unit for weather display. */
  temperatureUnit: TemperatureUnit;
  /** Weather location override. Empty = auto-detect via IP geolocation. */
  weatherLocation: string;
  weatherLat: number | null;
  weatherLon: number | null;
  /** Increase contrast and reduce transparency for bright/high-glare environments. */
  highVisibility: boolean;
  /** Reduce or disable most animations/transitions app-wide for accessibility. */
  reducedMotion: boolean;
  /** When true, show a confirmation dialog before closing the app window. */
  confirmOnClose: boolean;
  /** When true, closing the window hides it to the system tray instead of quitting. */
  minimizeToTray: boolean;
  /** When true, the app hides from the dock (macOS) or taskbar (Windows/Linux). */
  hideDockIcon: boolean;
  /** When true, show the system tray (Windows/Linux) or menu bar (macOS) icon. */
  showTrayIcon: boolean;
  /** Update source channel and launch check behavior. */
  updates: UpdateSettings;
  setUserAgentPreset: (preset: UserAgentPreset) => void;
  setUserAgentCustomValue: (value: string) => void;
  setUserAgentScopeOverride: (scope: UserAgentScope, value: string) => void;
  resetUserAgentScopeOverrides: () => void;
  getUserAgentScopeOverride: (scope: UserAgentScope) => string;
  resetUserAgent: () => void;
  getEffectiveUserAgent: () => Promise<string>;
  getEffectiveUserAgentForScope: (scope: UserAgentScope) => Promise<string>;
  syncUserAgentToBackend: () => Promise<void>;
  setFax: (update: Partial<FaxSettings>) => void;
  resetFax: () => void;
  setPacketMonitor: (update: Partial<PacketMonitorSettings>) => void;
  resetPacketMonitor: () => void;
  setTerminal: (update: Partial<TerminalSettings>) => void;
  resetTerminal: () => void;
  setMediaPorts: (update: Partial<MediaPortSettings>) => void;
  resetMediaPorts: () => void;
  /** Sync media port range to the Rust backend allocator. */
  syncMediaPortsToBackend: () => Promise<void>;
  setTimezone: (tz: TimezoneSetting) => void;
  setTimeFormat: (format: TimeFormatSetting) => void;
  setDateFormat: (format: DateFormatSetting) => void;
  setTemperatureUnit: (unit: TemperatureUnit) => void;
  setWeatherLocation: (location: string) => void;
  setWeatherCoords: (lat: number | null, lon: number | null) => void;
  setHighVisibility: (v: boolean) => void;
  setReducedMotion: (v: boolean) => void;
  setConfirmOnClose: (v: boolean) => void;
  setMinimizeToTray: (v: boolean) => void;
  syncMinimizeToTrayToBackend: () => Promise<void>;
  setHideDockIcon: (v: boolean) => void;
  syncHideDockIconToBackend: () => Promise<void>;
  setShowTrayIcon: (v: boolean) => void;
  syncShowTrayIconToBackend: () => Promise<void>;
  setUpdateChannel: (channel: ReleaseChannel) => void;
  setUpdateAutoCheckOnLaunch: (enabled: boolean) => void;
}

const defaultUserAgentScopeOverrides: UserAgentScopeOverrides = {
  composerHttp: "",
  composerGraphql: "",
  composerSip: "",
  provisionFetch: "",
};

const defaultUserAgentSettings: UserAgentSettings = {
  preset: "default",
  customValue: "",
  overrides: defaultUserAgentScopeOverrides,
};

const defaultFaxSettings: FaxSettings = {
  ecm: true,
  useG711Only: false,
  baudRate: 14400,
  resolution: "standard",
  sendRetries: 3,
  receiveTimeoutSecs: 120,
  disTimeoutSecs: 15,
  mcfTimeoutSecs: 10,
  autoAnswerRings: 0,
  saveReceivedToFolder: "",
  stationId: "",
};

const defaultPacketMonitorSettings: PacketMonitorSettings = {
  pipelineMode: true,
  autoScroll: true,
  ringBufferCapacity: 2_000_000,
  maxSessionsInMemory: 10,
  sessionTimeoutSecs: 30 * 60,
  packetPollIntervalMs: 1200,
  statsPollIntervalMs: 1500,
  pageSize: 1000,
  streamMaxPackets: 10_000,
  pipelineRawQueueSize: 65_536,
  pipelineParsedQueueSize: 32_768,
  pipelineParserThreads: 0,
  pipelineWriteBatchSize: 1000,
  rtpPortRangeLow: 10_000,
  rtpPortRangeHigh: 60_000,
};

const defaultTerminalSettings: TerminalSettings = {
  fontSize: 13,
  fontFamily: '"Geist Mono Variable", monospace',
  lineHeight: 1.4,
  cursorStyle: "bar",
  cursorBlink: true,
  scrollback: 10000,
  confirmOnClose: true,
};

const defaultMediaPortSettings: MediaPortSettings = {
  rangeLow: 10000,
  rangeHigh: 65500,
};

const defaultTimezone: TimezoneSetting = "";
const defaultTimeFormat: TimeFormatSetting = "24h";
const defaultUpdateSettings: UpdateSettings = {
  channel: DEFAULT_RELEASE_CHANNEL,
  autoCheckOnLaunch: true,
};

export const useSettingsStore = create<AppSettingsState>()(
  (set, get) => ({
    userAgent: defaultUserAgentSettings,
    fax: defaultFaxSettings,
    packetMonitor: defaultPacketMonitorSettings,
    terminal: defaultTerminalSettings,
    mediaPorts: defaultMediaPortSettings,
    timezone: defaultTimezone,
    timeFormat: defaultTimeFormat,
    dateFormat: "system" as DateFormatSetting,
    temperatureUnit: "celsius" as TemperatureUnit,
    weatherLocation: "",
    weatherLat: null,
    weatherLon: null,
    highVisibility: false,
    reducedMotion: false,
    confirmOnClose: false,
    minimizeToTray: false,
    hideDockIcon: false,
    showTrayIcon: true,
    updates: defaultUpdateSettings,

      setTimezone: (tz) => set({ timezone: tz }),
      setTimeFormat: (format) => set({ timeFormat: format }),
      setDateFormat: (format) => set({ dateFormat: format }),
      setTemperatureUnit: (unit) => set({ temperatureUnit: unit }),
      setWeatherLocation: (location) => set({ weatherLocation: location }),
      setWeatherCoords: (lat, lon) => set({ weatherLat: lat, weatherLon: lon }),
      setHighVisibility: (v) => set({ highVisibility: v }),
      setReducedMotion: (v) => set({ reducedMotion: v }),
      setConfirmOnClose: (v) => set({ confirmOnClose: v }),
      setMinimizeToTray: (v) => {
        set({ minimizeToTray: v });
        if (v && !get().showTrayIcon) {
          set({ showTrayIcon: true });
          get().syncShowTrayIconToBackend();
        }
        get().syncMinimizeToTrayToBackend();
      },
      syncMinimizeToTrayToBackend: async () => {
        try {
          await invokeTauri("set_minimize_to_tray", { enabled: get().minimizeToTray });
        } catch {
          // Backend not ready (dev without Tauri)
        }
      },
      setHideDockIcon: (v) => {
        set({ hideDockIcon: v });
        if (v) {
          if (!get().minimizeToTray) {
            set({ minimizeToTray: true });
            get().syncMinimizeToTrayToBackend();
          }
          if (!get().showTrayIcon) {
            set({ showTrayIcon: true });
            get().syncShowTrayIconToBackend();
          }
        }
        get().syncHideDockIconToBackend();
      },
      syncHideDockIconToBackend: async () => {
        try {
          await invokeTauri("set_hide_dock_icon", { enabled: get().hideDockIcon });
        } catch {
          // Backend not ready (dev without Tauri)
        }
      },
      setShowTrayIcon: (v) => {
        set({ showTrayIcon: v });
        if (!v) {
          if (get().hideDockIcon) {
            set({ hideDockIcon: false });
            get().syncHideDockIconToBackend();
          }
          if (get().minimizeToTray) {
            set({ minimizeToTray: false });
            get().syncMinimizeToTrayToBackend();
          }
        }
        get().syncShowTrayIconToBackend();
      },
      syncShowTrayIconToBackend: async () => {
        try {
          await invokeTauri("set_show_tray_icon", { enabled: get().showTrayIcon });
        } catch {
          // Backend not ready (dev without Tauri)
        }
      },
      setUpdateChannel: (channel) =>
        set((s) => ({ updates: { ...s.updates, channel } })),
      setUpdateAutoCheckOnLaunch: (enabled) =>
        set((s) => ({ updates: { ...s.updates, autoCheckOnLaunch: enabled } })),

      setUserAgentPreset: (preset) => {
        set((s) => ({
          userAgent: {
            ...s.userAgent,
            preset,
            overrides: { ...defaultUserAgentScopeOverrides, ...(s.userAgent.overrides ?? {}) },
          },
        }));
        get().syncUserAgentToBackend();
      },

      setUserAgentCustomValue: (value) => {
        set((s) => ({
          userAgent: {
            ...s.userAgent,
            customValue: value,
            overrides: { ...defaultUserAgentScopeOverrides, ...(s.userAgent.overrides ?? {}) },
          },
        }));
        get().syncUserAgentToBackend();
      },

      setUserAgentScopeOverride: (scope, value) => {
        set((s) => ({
          userAgent: {
            ...s.userAgent,
            overrides: {
              ...defaultUserAgentScopeOverrides,
              ...(s.userAgent.overrides ?? {}),
              [scope]: value,
            },
          },
        }));
      },

      resetUserAgentScopeOverrides: () => {
        set((s) => ({
          userAgent: {
            ...s.userAgent,
            overrides: defaultUserAgentScopeOverrides,
          },
        }));
      },

      getUserAgentScopeOverride: (scope) => {
        const { userAgent } = get();
        return userAgent.overrides?.[scope] ?? "";
      },

      resetUserAgent: () => {
        set({ userAgent: defaultUserAgentSettings });
        get().syncUserAgentToBackend();
      },

      getEffectiveUserAgent: async () => {
        const { userAgent } = get();
        if (userAgent.preset === "minimal")
          return invokeTauri<string>("get_minimal_user_agent");
        if (userAgent.preset === "custom" && userAgent.customValue.trim())
          return userAgent.customValue.trim();
        // Ensure the username flag matches the current preset before querying,
        // so we don't race with syncUserAgentToBackend.
        await invokeTauri("set_include_username_in_user_agent", {
          include: userAgent.preset === "default",
        });
        return invokeTauri<string>("get_default_user_agent");
      },

      getEffectiveUserAgentForScope: async (scope) => {
        const scoped = get().getUserAgentScopeOverride(scope).trim();
        if (scoped) return scoped;
        return get().getEffectiveUserAgent();
      },

      syncUserAgentToBackend: async () => {
        try {
          const { userAgent } = get();
          await invokeTauri("set_include_username_in_user_agent", {
            include: userAgent.preset === "default",
          });
          const effective = await get().getEffectiveUserAgent();
          const defaultFromBackend = await invokeTauri<string>("get_default_user_agent");
          // If effective is the same as backend default, clear override so backend builds it
          if (effective === defaultFromBackend) {
            await invokeTauri("set_app_user_agent", { overrideValue: null });
          } else {
            await invokeTauri("set_app_user_agent", { overrideValue: effective });
          }
        } catch {
          // Ignore if backend not ready (e.g. dev without Tauri)
        }
      },

      setFax: (update) => set((s) => ({ fax: { ...s.fax, ...update } })),
      resetFax: () => set({ fax: defaultFaxSettings }),

      setMediaPorts: (update) => {
        set((s) => ({ mediaPorts: { ...s.mediaPorts, ...update } }));
        get().syncMediaPortsToBackend();
      },
      resetMediaPorts: () => {
        set({ mediaPorts: defaultMediaPortSettings });
        get().syncMediaPortsToBackend();
      },
      syncMediaPortsToBackend: async () => {
        try {
          const { mediaPorts } = get();
          await invokeTauri("set_media_port_range", {
            rangeLow: mediaPorts.rangeLow,
            rangeHigh: mediaPorts.rangeHigh,
          });
        } catch {
          // Backend not ready (dev without Tauri)
        }
      },

      setPacketMonitor: (update) => set((s) => ({ packetMonitor: { ...s.packetMonitor, ...update } })),
      resetPacketMonitor: () => set({ packetMonitor: defaultPacketMonitorSettings }),

    setTerminal: (update) => set((s) => ({ terminal: { ...s.terminal, ...update } })),
    resetTerminal: () => set({ terminal: defaultTerminalSettings }),
  }),
);
