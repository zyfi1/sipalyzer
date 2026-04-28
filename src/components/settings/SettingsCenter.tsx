import { useEffect, useState, useCallback, useRef, lazy, Suspense, type HTMLAttributes } from "react";
import { useSettingsStore, UserAgentPreset, type UserAgentScope, type TimeFormatSetting, type DateFormatSetting, type TemperatureUnit, type TerminalCursorStyle } from "@/stores/settingsStore";
import { useLayoutStore, type SettingsCenterTab } from "@/stores/layoutStore";
import { NotificationSettings } from "@/components/notifications/NotificationSettings";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RotateCcw, X, Shield, Info, MapPin, Loader2, AppleLogo, WindowsLogo, RefreshCw, Download, GitBranch } from "@/lib/icons";
import { AdminPasswordDialog } from "@/components/admin/AdminPasswordDialog";
import { navigateTo } from "@/lib/navigation";
import { fetchUrl } from "@/api/provision";
import { exportFullAppBackup, restoreFullAppBackupFromText, auditBackupRestoreFailure } from "@/lib/appBackup";

import clsx from "clsx";
import settingsStyles from "./settingsCenter.module.css";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { RELEASE_CHANNELS, type ReleaseChannel } from "@/lib/updater/channels";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { FAX_BAUD_RATES } from "@/api/fax";
import type { FaxResolution, FaxSettings, PacketMonitorSettings } from "@/stores/settingsStore";
import { APP_TIMEZONE_OPTIONS } from "@/lib/dateTime";
import {
  autoUpdate,
  flip,
  offset,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";

type DivProps = HTMLAttributes<HTMLDivElement>;
type StackProps = DivProps & { gap?: string | number };
type GroupProps = DivProps & {
  justify?: string;
  align?: string;
  wrap?: string;
  gap?: string | number;
};

function Paper({ className, children, ...rest }: DivProps) {
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}

function Stack({ className, children, ...rest }: StackProps) {
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}

function Group({ className, children, ...rest }: GroupProps) {
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}
const SettingsAboutPanel = lazy(() =>
  import("./SettingsAboutPanel").then((m) => ({ default: m.SettingsAboutPanel })),
);
const SoftphoneSettingsView = lazy(() =>
  import("@/components/soft-phone/SettingsView").then((m) => ({ default: m.SettingsView })),
);

interface LocationSuggestion {
  /** Friendly label shown in the dropdown */
  display: string;
  /** Short value stored & sent to wttr.in (city or city, country) */
  query: string;
  lat: number;
  lon: number;
}

function isUpdaterNotConfiguredError(message: string | null | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("updater is not configured yet") ||
    normalized.includes("missing sipalyzer_updater_pubkey")
  );
}

function formatPublishedAt(value: string): string {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString();
  }
  return value;
}

async function searchLocations(search: string): Promise<LocationSuggestion[]> {
  if (search.length < 2) return [];
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(search)}&format=json&addressdetails=1&limit=5&accept-language=en`;
    const raw = await fetchUrl(url);
    const data = JSON.parse(raw) as {
      display_name: string;
      lat: string;
      lon: string;
      address?: {
        city?: string; town?: string; village?: string;
        county?: string; state?: string; country?: string;
        postcode?: string;
      };
    }[];

    const seen = new Set<string>();
    const results: LocationSuggestion[] = [];

    for (const item of data) {
      const addr = item.address ?? {};
      const city = addr.city || addr.town || addr.village || addr.county || "";
      const region = addr.state || "";
      const country = addr.country || "";

      // Display: full "City, State, Country"
      const display = [city, region, country].filter(Boolean).join(", ") || item.display_name;
      // Query for wttr.in: just "City" or "City, Country" for disambiguation
      const query = city
        ? (country ? `${city}, ${country}` : city)
        : item.display_name.split(",")[0]?.trim() || search;

      if (seen.has(query)) continue;
      seen.add(query);
      results.push({ display, query, lat: parseFloat(item.lat), lon: parseFloat(item.lon) });
    }

    return results;
  } catch {
    return [];
  }
}

function WeatherLocationInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const setWeatherCoords = useSettingsStore((s) => s.setWeatherCoords);
  const [draft, setDraft] = useState(value);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const blurTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const justCommittedRef = useRef(false);
  const {
    refs,
    floatingStyles,
    context: floatingContext,
  } = useFloating({
    open: showSuggestions && suggestions.length > 0,
    onOpenChange: setShowSuggestions,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
            maxHeight: "260px",
          });
        },
        padding: 8,
      }),
    ],
  });
  const dismiss = useDismiss(floatingContext, { outsidePressEvent: "mousedown" });
  const role = useRole(floatingContext, { role: "listbox" });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = useCallback((loc: string) => {
    const trimmed = loc.trim();
    justCommittedRef.current = true;
    setDraft(trimmed);
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightIdx(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    if (trimmed !== value) onChange(trimmed);
    setTimeout(() => { justCommittedRef.current = false; }, 200);
  }, [value, onChange]);

  const handleChange = useCallback((text: string) => {
    setDraft(text);
    setHighlightIdx(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const results = await searchLocations(text.trim());
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setSearching(false);
    }, 400);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === "Enter") commit(draft);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
        const sel = suggestions[highlightIdx]!;
        commit(sel.query);
        setWeatherCoords(sel.lat, sel.lon);
      } else {
        commit(draft);
      }
    } else if (e.key === "Escape") {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [showSuggestions, suggestions, highlightIdx, draft, commit]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className={settingsStyles.weatherLocationContainer}>
      <div ref={refs.setReference} className={settingsStyles.weatherLocationContainer}>
        <Input
          id="settings-weather-location"
          placeholder="Search city, ZIP, or coordinates..."
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => {
              if (justCommittedRef.current) return;
              if (!containerRef.current?.contains(document.activeElement)) {
                commit(draft);
              }
            }, 200);
          }}
          onKeyDown={handleKeyDown}
          className={settingsStyles.weatherLocationInput}
          {...getReferenceProps()}
        />
        <div className={settingsStyles.weatherLocationAdornment}>
          {searching ? (
            <Loader2 className={settingsStyles.weatherLocationSpinner} />
          ) : (
            <MapPin className={settingsStyles.weatherLocationIcon} />
          )}
        </div>
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className={clsx(
            "ui-floating-menu-panel ui-floating-surface",
            settingsStyles.weatherSuggestions,
          )}
          {...getFloatingProps()}
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.display}-${i}`}
              type="button"
              className={clsx(
                "ui-floating-item",
                settingsStyles.suggestBtn,
                i === highlightIdx && settingsStyles.suggestBtnHighlight,
              )}
              onMouseEnter={() => setHighlightIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s.query);
                setWeatherCoords(s.lat, s.lon);
              }}
            >
              <MapPin className={settingsStyles.suggestionIcon} />
              <span className={settingsStyles.suggestionLabel}>{s.display}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface SettingsCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsCenter({ isOpen, onClose }: SettingsCenterProps) {
  const userAgent = useSettingsStore((s) => s.userAgent);
  const fax = useSettingsStore((s) => s.fax);
  const timezone = useSettingsStore((s) => s.timezone);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const setUserAgentPreset = useSettingsStore((s) => s.setUserAgentPreset);
  const setUserAgentCustomValue = useSettingsStore((s) => s.setUserAgentCustomValue);
  const setUserAgentScopeOverride = useSettingsStore((s) => s.setUserAgentScopeOverride);
  const resetUserAgentScopeOverrides = useSettingsStore((s) => s.resetUserAgentScopeOverrides);
  const resetUserAgent = useSettingsStore((s) => s.resetUserAgent);
  const getEffectiveUserAgent = useSettingsStore((s) => s.getEffectiveUserAgent);
  const getEffectiveUserAgentForScope = useSettingsStore((s) => s.getEffectiveUserAgentForScope);
  const syncUserAgentToBackend = useSettingsStore((s) => s.syncUserAgentToBackend);
  const setFax = useSettingsStore((s) => s.setFax);
  const mediaPorts = useSettingsStore((s) => s.mediaPorts);
  const setMediaPorts = useSettingsStore((s) => s.setMediaPorts);
  const packetMonitor = useSettingsStore((s) => s.packetMonitor);
  const setPacketMonitor = useSettingsStore((s) => s.setPacketMonitor);
  const resetPacketMonitor = useSettingsStore((s) => s.resetPacketMonitor);
  const setTimezone = useSettingsStore((s) => s.setTimezone);
  const setTimeFormat = useSettingsStore((s) => s.setTimeFormat);
  const dateFormat = useSettingsStore((s) => s.dateFormat);
  const setDateFormat = useSettingsStore((s) => s.setDateFormat);
  const temperatureUnit = useSettingsStore((s) => s.temperatureUnit);
  const setTemperatureUnit = useSettingsStore((s) => s.setTemperatureUnit);
  const weatherLocation = useSettingsStore((s) => s.weatherLocation);
  const setWeatherLocation = useSettingsStore((s) => s.setWeatherLocation);
  const highVisibility = useSettingsStore((s) => s.highVisibility);
  const setHighVisibility = useSettingsStore((s) => s.setHighVisibility);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const setReducedMotion = useSettingsStore((s) => s.setReducedMotion);
  const resetFax = useSettingsStore((s) => s.resetFax);
  const terminalSettings = useSettingsStore((s) => s.terminal);
  const setTerminal = useSettingsStore((s) => s.setTerminal);
  const resetTerminal = useSettingsStore((s) => s.resetTerminal);
  const confirmOnClose = useSettingsStore((s) => s.confirmOnClose);
  const setConfirmOnClose = useSettingsStore((s) => s.setConfirmOnClose);
  const minimizeToTray = useSettingsStore((s) => s.minimizeToTray);
  const setMinimizeToTray = useSettingsStore((s) => s.setMinimizeToTray);
  const hideDockIcon = useSettingsStore((s) => s.hideDockIcon);
  const setHideDockIcon = useSettingsStore((s) => s.setHideDockIcon);
  const showTrayIcon = useSettingsStore((s) => s.showTrayIcon);
  const setShowTrayIcon = useSettingsStore((s) => s.setShowTrayIcon);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const updates = useSettingsStore((s) => s.updates);
  const setUpdateChannel = useSettingsStore((s) => s.setUpdateChannel);
  const setUpdateAutoCheckOnLaunch = useSettingsStore((s) => s.setUpdateAutoCheckOnLaunch);
  const updaterChecking = useUpdaterStore((s) => s.checking);
  const updaterInstalling = useUpdaterStore((s) => s.installing);
  const availableUpdate = useUpdaterStore((s) => s.availableUpdate);
  const updaterLastCheckedAt = useUpdaterStore((s) => s.lastCheckedAt);
  const updaterLastError = useUpdaterStore((s) => s.lastError);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const installAvailableUpdate = useUpdaterStore((s) => s.installAvailableUpdate);
  const isMac = navigator.platform.includes("Mac");
  const isWindows = navigator.platform.includes("Win");
  const macVisibilityMode: "dock" | "menu-bar" | "both" = hideDockIcon
    ? "menu-bar"
    : showTrayIcon
      ? "both"
      : "dock";
  const [preview, setPreview] = useState<string>("");
  const [scopePreview, setScopePreview] = useState<Record<UserAgentScope, string>>({
    composerHttp: "SIPalyzer/1.0",
    composerGraphql: "SIPalyzer/1.0",
    composerSip: "SIPalyzer/1.0",
    provisionFetch: "SIPalyzer/1.0",
  });
  const [aboutOpen, setAboutOpen] = useState(false);
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [adminDialogMode, setAdminDialogMode] = useState<"set" | "verify">("verify");
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  const runUpdateCheck = useCallback(async () => {
    const result = await checkForUpdates(updates.channel);
    const checkError = useUpdaterStore.getState().lastError;
    if (checkError) {
      if (isUpdaterNotConfiguredError(checkError)) {
        return;
      }
      addNotification({
        type: "error",
        title: "Update Check Failed",
        description: checkError,
        source: "settings",
      });
      return;
    }
    if (result) {
      addNotification({
        type: "info",
        title: "Update Available",
        description: `Version ${result.version} is ready on the ${updates.channel} channel.`,
        source: "settings",
      });
    } else {
      addNotification({
        type: "success",
        title: "Up to Date",
        description: `No updates available on the ${updates.channel} channel.`,
        source: "settings",
      });
    }
  }, [addNotification, checkForUpdates, updates.channel]);

  const runInstallUpdate = useCallback(async () => {
    const installed = await installAvailableUpdate(updates.channel);
    const installError = useUpdaterStore.getState().lastError;
    if (installError) {
      if (isUpdaterNotConfiguredError(installError)) {
        return;
      }
      addNotification({
        type: "error",
        title: "Install Failed",
        description: installError,
        source: "settings",
      });
      return;
    }
    if (installed) {
      addNotification({
        type: "success",
        title: "Update Installed",
        description: `Version ${installed.version} was installed. Restart SIPalyzer to finish applying it.`,
        source: "settings",
      });
      return;
    }
    addNotification({
      type: "info",
      title: "No Update Available",
      description: `No installable update was found on the ${updates.channel} channel.`,
      source: "settings",
    });
  }, [addNotification, installAvailableUpdate, updates.channel]);

  const handleAdminClick = useCallback(async () => {
    try {
      const { hasAdminPassword } = await import("@/api/admin");
      const hasPassword = await hasAdminPassword();
      setAdminDialogMode(hasPassword ? "verify" : "set");
      setAdminDialogOpen(true);
    } catch {
      setAdminDialogMode("set");
      setAdminDialogOpen(true);
    }
  }, []);

  const handleAdminSuccess = useCallback(() => {
    setAdminDialogOpen(false);
    onClose();
    navigateTo("admin-center");
  }, [onClose]);

  const handleCreateFullBackup = useCallback(async () => {
    setBackupBusy(true);
    try {
      const path = await exportFullAppBackup("settings-center");
      addNotification({
        type: "success",
        title: "Backup Created",
        description: `Saved full app backup to ${path}`,
        source: "settings",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addNotification({
        type: "error",
        title: "Backup Failed",
        description: message,
        source: "settings",
      });
    } finally {
      setBackupBusy(false);
    }
  }, [addNotification]);

  const handleRestoreFilePicked = useCallback(async (file: File | null) => {
    if (!file) return;
    setRestoreBusy(true);
    try {
      const text = await file.text();
      await restoreFullAppBackupFromText(text, "settings-center", file.name);
      addNotification({
        type: "success",
        title: "Backup Restored",
        description: "Full app state restored from backup file.",
        source: "settings",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await auditBackupRestoreFailure("settings-center", message, file.name);
      addNotification({
        type: "error",
        title: "Restore Failed",
        description: message,
        source: "settings",
      });
    } finally {
      setRestoreBusy(false);
      if (backupFileInputRef.current) backupFileInputRef.current.value = "";
    }
  }, [addNotification]);

  useEffect(() => {
    if (isOpen) syncUserAgentToBackend();
  }, [isOpen, syncUserAgentToBackend]);

  useEffect(() => {
    let cancelled = false;
    getEffectiveUserAgent()
      .then((ua) => { if (!cancelled) setPreview(ua); })
      .catch(() => { if (!cancelled) setPreview("SIPalyzer"); });
    return () => { cancelled = true; };
  }, [userAgent.preset, userAgent.customValue, getEffectiveUserAgent]);

  useEffect(() => {
    let cancelled = false;
    const scopes: UserAgentScope[] = ["composerHttp", "composerGraphql", "composerSip", "provisionFetch"];
    Promise.all(
      scopes.map(async (scope) => {
        try {
          const value = await getEffectiveUserAgentForScope(scope);
          return [scope, value || "SIPalyzer/1.0"] as const;
        } catch {
          return [scope, "SIPalyzer/1.0"] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setScopePreview(Object.fromEntries(entries) as Record<UserAgentScope, string>);
    });
    return () => { cancelled = true; };
  }, [userAgent.preset, userAgent.customValue, userAgent.overrides, getEffectiveUserAgentForScope]);

  const settingsCenterTab = useLayoutStore((s) => s.settingsCenterTab);
  const setSettingsCenterTab = useLayoutStore((s) => s.setSettingsCenterTab);
  const userAgentScopeRows: Array<{ scope: UserAgentScope; label: string; description: string; placeholder: string }> = [
    {
      scope: "composerHttp",
      label: "Composer HTTP",
      description: "Used when adding/refreshing HTTP request headers in Composer.",
      placeholder: "Inherit global",
    },
    {
      scope: "composerGraphql",
      label: "Composer GraphQL",
      description: "Used for GraphQL request headers in Composer.",
      placeholder: "Inherit global",
    },
    {
      scope: "composerSip",
      label: "Composer SIP",
      description: "Used for SIP User-Agent header auto-fill and registrar imports.",
      placeholder: "Inherit global",
    },
    {
      scope: "provisionFetch",
      label: "Provisioning Fetch",
      description: "Used for provisioning contact-file fetch requests.",
      placeholder: "Inherit request/global",
    },
  ];

  // Defensive: ensure fax is always a full object (e.g. after store migration)
  const faxSafe: FaxSettings = fax ?? {
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

  // Defensive: ensure packetMonitor is always a full object
  const pm: PacketMonitorSettings = packetMonitor ?? {
    pipelineMode: true,
    autoScroll: true,
    ringBufferCapacity: 2_000_000,
    maxSessionsInMemory: 10,
    sessionTimeoutSecs: 1800,
    packetPollIntervalMs: 500,
    statsPollIntervalMs: 1000,
    pageSize: 5000,
    streamMaxPackets: 10_000,
    pipelineRawQueueSize: 65_536,
    pipelineParsedQueueSize: 32_768,
    pipelineParserThreads: 0,
    pipelineWriteBatchSize: 1000,
    rtpPortRangeLow: 10_000,
    rtpPortRangeHigh: 60_000,
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-x-0 top-9 bottom-7 bg-black/25 z-40 transition-smooth"
        onClick={onClose}
      />
      <div className={clsx(
        settingsStyles.sheet,
        "animate-in slide-in-from-right duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
      )}>
        <Tabs
          value={settingsCenterTab}
          onValueChange={(v) => setSettingsCenterTab(v as SettingsCenterTab)}
          className={settingsStyles.tabsRoot}
        >
          {/* Header with top-level tabs */}
          <header className={clsx("ui-section-header-md", settingsStyles.headerShell)}>
            <div className={settingsStyles.headerTabsScroll}>
              <TabsList className={clsx("settings-nav-tabs", settingsStyles.navTabsMin)}>
                <TooltipWrapper entry={tooltips.settingsGeneral}>
                  <TabsTrigger value="general" className={clsx("settings-nav-tab", settingsStyles.navTabTrigger)}>
                    General
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsNotifications}>
                  <TabsTrigger value="notifications" className={clsx("settings-nav-tab", settingsStyles.navTabTrigger)}>
                    Notifications
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsUserAgent}>
                  <TabsTrigger value="user-agent" className={clsx("settings-nav-tab", settingsStyles.navTabTrigger)}>
                    User-Agent
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsPacketMonitor}>
                  <TabsTrigger value="packet-monitor" className={clsx("settings-nav-tab", settingsStyles.navTabTrigger)}>
                    Packet Monitor
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsFax}>
                  <TabsTrigger value="fax" className={clsx("settings-nav-tab", settingsStyles.navTabTrigger)}>
                    Fax
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsTerminal}>
                  <TabsTrigger value="terminal" className={clsx("settings-nav-tab", settingsStyles.navTabTrigger)}>
                    Terminal
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsSoftPhone}>
                  <TabsTrigger value="soft-phone" className={clsx("settings-nav-tab", settingsStyles.navTabTrigger)}>
                    Soft Phone
                  </TabsTrigger>
                </TooltipWrapper>
              </TabsList>
            </div>
            <div className={settingsStyles.headerActionsRow}>
              <TooltipWrapper entry={tooltips.settingsAdmin}>
                <Button variant="secondary" size="icon" onClick={handleAdminClick} className={settingsStyles.iconButtonSize} aria-label="Admin">
                  <Shield className={settingsStyles.iconMd} />
                </Button>
              </TooltipWrapper>
              <TooltipWrapper content="About SIPalyzer">
                <Button
                  variant={aboutOpen ? "secondary" : "outline"}
                  size="icon"
                  onClick={() => setAboutOpen((o) => !o)}
                  className={settingsStyles.iconButtonSize}
                  aria-label="About SIPalyzer"
                >
                  <Info className={settingsStyles.iconMd} />
                </Button>
              </TooltipWrapper>
              <TooltipWrapper content="Close settings">
                <Button variant="secondary" size="icon" onClick={onClose} className={settingsStyles.iconButtonSize} aria-label="Close settings">
                  <X className={settingsStyles.iconMd} />
                </Button>
              </TooltipWrapper>
            </div>
          </header>

          {aboutOpen && (
            <Suspense
              fallback={
                <div className={settingsStyles.aboutFallbackOverlay}>
                  <Loader2 className={settingsStyles.iconSpinnerLgMuted} />
                </div>
              }
            >
              <SettingsAboutPanel onClose={() => setAboutOpen(false)} />
            </Suspense>
          )}

          <TabsContent value="general" className={settingsStyles.tabsContentP6Space6}>
            <div className={settingsStyles.generalLayout}>
            <div className={settingsStyles.sectionIntro}>
              <h2 className={settingsStyles.textBaseSemibold}>Date & time</h2>
              <p className={settingsStyles.textSmMuted}>
                All timestamps in the app are shown in this timezone and format.
              </p>
            </div>
            <div className={settingsStyles.gridGap6Cols2}>
              <div className={settingsStyles.stack2}>
                <Label htmlFor="settings-timezone">Time zone</Label>
                <AppDropdown
                  id="settings-timezone"
                  className={settingsStyles.wFull}
                  value={timezone === "" ? "local" : timezone}
                  onValueChange={(v) => setTimezone(v === "local" ? "" : v)}
                  placeholder="Local (system)"
                  options={[
                    { value: "local", label: "Local (system)" },
                    ...APP_TIMEZONE_OPTIONS.filter((o) => o.value !== "").map((o) => ({
                      value: o.value,
                      label: o.label,
                    })),
                  ]}
                />
              </div>
              <div className={settingsStyles.stack2}>
                <Label htmlFor="settings-time-format">Time format</Label>
                <AppDropdown
                  id="settings-time-format"
                  className={settingsStyles.wFull}
                  value={timeFormat}
                  onValueChange={(v) => setTimeFormat(v as TimeFormatSetting)}
                  options={[
                    { value: "24h", label: "24-hour (e.g. 14:30)" },
                    { value: "12h", label: "12-hour AM/PM (e.g. 2:30 PM)" },
                  ]}
                />
              </div>
              <div className={settingsStyles.stack2}>
                <Label htmlFor="settings-date-format">Date format</Label>
                <AppDropdown
                  id="settings-date-format"
                  className={settingsStyles.wFull}
                  value={dateFormat}
                  onValueChange={(v) => setDateFormat(v as DateFormatSetting)}
                  options={[
                    { value: "system", label: "System default" },
                    { value: "MM/DD/YYYY", label: "MM/DD/YYYY (US)" },
                    { value: "DD/MM/YYYY", label: "DD/MM/YYYY (UK/EU)" },
                    { value: "YYYY-MM-DD", label: "YYYY-MM-DD (ISO)" },
                    { value: "DD.MM.YYYY", label: "DD.MM.YYYY (DE)" },
                  ]}
                />
              </div>
              <div className={settingsStyles.stack2}>
                <Label htmlFor="settings-temp-unit">Temperature unit</Label>
                <AppDropdown
                  id="settings-temp-unit"
                  className={settingsStyles.wFull}
                  value={temperatureUnit}
                  onValueChange={(v) => setTemperatureUnit(v as TemperatureUnit)}
                  options={[
                    { value: "celsius", label: "Celsius (°C)" },
                    { value: "fahrenheit", label: "Fahrenheit (°F)" },
                  ]}
                />
              </div>
            </div>

            {/* Weather */}
            <div className={settingsStyles.sectionIntro}>
              <h2 className={settingsStyles.textBaseSemibold}>Weather</h2>
              <p className={settingsStyles.textSmMuted}>
                Set a location for the home screen weather display. Leave empty to auto-detect.
              </p>
            </div>
            <div className={settingsStyles.gridGap6Cols2}>
              <div className={settingsStyles.stack2}>
                <Label htmlFor="settings-weather-location">Location</Label>
                <WeatherLocationInput
                  value={weatherLocation}
                  onChange={setWeatherLocation}
                />
                <p className={settingsStyles.textXsMuted}>
                  City name, ZIP code, or coordinates (e.g. "New York", "10001", "40.7,-74.0").
                  Press Enter or click away to apply.
                </p>
              </div>
            </div>

            {/* Visibility */}
            <div className={settingsStyles.sectionIntro}>
              <h2 className={settingsStyles.textBaseSemibold}>Visibility</h2>
              <p className={settingsStyles.textSmMuted}>
                Improve readability in bright or high-glare environments.
              </p>
            </div>
            <Paper className={clsx("ui-panel-shell", settingsStyles.panelShellOverflowDivided)}>
              <Group className={settingsStyles.preferenceRow}>
                <div className={settingsStyles.stack0_5}>
                  <Label htmlFor="settings-high-visibility" className={settingsStyles.cursorPointer}>
                    High visibility mode
                  </Label>
                  <p className={settingsStyles.textXsMuted}>
                    Boost contrast, strengthen borders, and reduce transparency app-wide.
                  </p>
                </div>
                <Switch
                  id="settings-high-visibility"
                  checked={highVisibility}
                  onCheckedChange={setHighVisibility}
                  aria-label="High visibility mode"
                  className={settingsStyles.preferenceControl}
                />
              </Group>
              <Group className={settingsStyles.preferenceRow}>
                <div className={settingsStyles.stack0_5}>
                  <Label htmlFor="settings-reduced-motion" className={settingsStyles.cursorPointer}>
                    Reduced motion
                  </Label>
                  <p className={settingsStyles.textXsMuted}>
                    Minimize animations and transitions for more comfortable motion-sensitive use.
                  </p>
                </div>
                <Switch
                  id="settings-reduced-motion"
                  checked={reducedMotion}
                  onCheckedChange={setReducedMotion}
                  aria-label="Reduced motion"
                  className={settingsStyles.preferenceControl}
                />
              </Group>
            </Paper>

            {/* Updates */}
            <div className={settingsStyles.sectionIntro}>
              <div className={settingsStyles.rowGap2}>
                <h2 className={settingsStyles.textBaseSemibold}>Updates</h2>
                <GitBranch className={settingsStyles.iconSmMuted} />
              </div>
              <p className={settingsStyles.textSmMuted}>
                Subscribe to GitHub release channels and manually install updates when available.
              </p>
            </div>
            <Paper className={clsx("ui-panel-shell", settingsStyles.panelShellOverflowDivided)}>
              <div className={settingsStyles.gridGap4P4Cols2}>
                <div className={settingsStyles.stack2}>
                  <Label htmlFor="settings-update-channel">Release channel</Label>
                  <AppDropdown
                    id="settings-update-channel"
                    value={updates.channel}
                    onValueChange={(value) => setUpdateChannel(value as ReleaseChannel)}
                    options={RELEASE_CHANNELS.map((channel) => ({
                      value: channel,
                      label: channel,
                    }))}
                  />
                  <p className={settingsStyles.textXsMuted}>
                    Beta is the default pre-release channel (newest builds). RC is late-stage prerelease; main is the stable release line.
                  </p>
                </div>
                <div className={settingsStyles.stack2}>
                  <Label>Channel status</Label>
                  <div className={settingsStyles.channelStatusBox}>
                    {availableUpdate ? (
                      <div className={settingsStyles.stack1}>
                        <p className={settingsStyles.fontMediumForeground}>Update available: {availableUpdate.version}</p>
                        {availableUpdate.publishedAt ? (
                          <p className={settingsStyles.textXsMuted}>Published: {formatPublishedAt(availableUpdate.publishedAt)}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className={settingsStyles.textMuted}>
                        {updaterLastCheckedAt
                          ? `No pending updates (last check: ${new Date(updaterLastCheckedAt).toLocaleString()})`
                          : "No checks run yet"}
                      </p>
                    )}
                  </div>
                  {isUpdaterNotConfiguredError(updaterLastError) ? (
                    <p className={settingsStyles.textXsMuted}>
                      Updater key not detected from override env vars. This build will use the configured app updater key.
                    </p>
                  ) : null}
                </div>
              </div>
              <Group className={settingsStyles.preferenceRow}>
                <div className={settingsStyles.stack0_5}>
                  <Label htmlFor="settings-update-check-launch" className={settingsStyles.cursorPointer}>
                    Check for updates on launch
                  </Label>
                  <p className={settingsStyles.textXsMuted}>
                    Run a background check at startup and show a header badge when a new release is found.
                  </p>
                </div>
                <Switch
                  id="settings-update-check-launch"
                  checked={updates.autoCheckOnLaunch}
                  onCheckedChange={setUpdateAutoCheckOnLaunch}
                  aria-label="Check for updates on launch"
                  className={settingsStyles.preferenceControl}
                />
              </Group>
              <Group className={settingsStyles.wrapGap2P4} gap="sm" align="center">
                <Button variant="secondary" size="sm" onClick={() => void runUpdateCheck()} disabled={updaterChecking || updaterInstalling}>
                  {updaterChecking ? <Loader2 className={settingsStyles.iconSpinnerSmMr} /> : <RefreshCw className={settingsStyles.iconSmMr} />}
                  Check Now
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void runInstallUpdate()}
                  disabled={!availableUpdate || updaterChecking || updaterInstalling}
                >
                  {updaterInstalling ? <Loader2 className={settingsStyles.iconSpinnerSmMr} /> : <Download className={settingsStyles.iconSmMr} />}
                  Install Update
                </Button>
              </Group>
            </Paper>

            {/* Window Behavior */}
            <div className={settingsStyles.sectionIntro}>
              <div className={settingsStyles.rowGap2}>
                <h2 className={settingsStyles.textBaseSemibold}>Window Behavior</h2>
                {(isMac || isWindows) && (
                  isMac ? (
                    <AppleLogo className={settingsStyles.iconSmMuted} aria-label="macOS settings" />
                  ) : (
                    <WindowsLogo className={settingsStyles.iconSmMuted} aria-label="Windows settings" />
                  )
                )}
              </div>
              <p className={settingsStyles.textSmMuted}>
                {isMac
                  ? "Configure Dock/menu bar presence and quit behavior for macOS."
                  : isWindows
                    ? "Configure taskbar/system tray presence and close behavior for Windows."
                    : "Control how the app appears in the system and behaves when closing."}
              </p>
            </div>
            <div className={clsx("ui-panel-shell", settingsStyles.panelShellOverflowDivided)}>
              {isMac ? (
                <>
                  <div className={settingsStyles.preferenceRow}>
                    <div className={settingsStyles.stack0_5}>
                      <Label className={settingsStyles.cursorDefault}>App visibility</Label>
                      <p className={settingsStyles.textXsMuted}>
                        Choose how SIPalyzer appears on macOS: Dock, menu bar, or both.
                      </p>
                    </div>
                    <RadioGroup
                      value={macVisibilityMode}
                      onValueChange={(next) => {
                        if (next === "dock") {
                          setHideDockIcon(false);
                          setShowTrayIcon(false);
                        } else if (next === "menu-bar") {
                          setHideDockIcon(true);
                          setShowTrayIcon(true);
                        } else {
                          setHideDockIcon(false);
                          setShowTrayIcon(true);
                        }
                      }}
                      className={settingsStyles.macVisibilityGroup}
                      aria-label="macOS app visibility"
                    >
                      <div className={clsx(settingsStyles.macVisOption, macVisibilityMode === "dock" && settingsStyles.macVisOptionActive)}>
                        <RadioGroupItem id="settings-mac-visibility-dock" value="dock" />
                        <Label htmlFor="settings-mac-visibility-dock" className={settingsStyles.cursorPointerTextXs}>Dock</Label>
                      </div>
                      <div className={clsx(settingsStyles.macVisOption, macVisibilityMode === "menu-bar" && settingsStyles.macVisOptionActive)}>
                        <RadioGroupItem id="settings-mac-visibility-menu" value="menu-bar" />
                        <Label htmlFor="settings-mac-visibility-menu" className={settingsStyles.cursorPointerTextXs}>Menu Bar</Label>
                      </div>
                      <div className={clsx(settingsStyles.macVisOption, macVisibilityMode === "both" && settingsStyles.macVisOptionActive)}>
                        <RadioGroupItem id="settings-mac-visibility-both" value="both" />
                        <Label htmlFor="settings-mac-visibility-both" className={settingsStyles.cursorPointerTextXs}>Both</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div className={settingsStyles.preferenceRow}>
                    <div className={settingsStyles.stack0_5}>
                      <Label htmlFor="settings-keep-running" className={settingsStyles.cursorPointer}>
                        Keep app running when window closes
                      </Label>
                      <p className={settingsStyles.textXsMuted}>
                        Closing the window keeps the app running in the background. Reopen from Dock or menu bar.
                      </p>
                    </div>
                    <Checkbox
                      id="settings-keep-running"
                      checked={minimizeToTray}
                      onCheckedChange={(v) => setMinimizeToTray(v === true)}
                      className={settingsStyles.preferenceControl}
                    />
                  </div>
                  <div className={settingsStyles.preferenceRow}>
                    <div className={settingsStyles.stack0_5}>
                      <Label htmlFor="settings-confirm-quit" className={settingsStyles.cursorPointer}>
                        Confirm before quit (Cmd+Q)
                      </Label>
                      <p className={settingsStyles.textXsMuted}>
                        {minimizeToTray
                          ? "Show a confirmation when quitting from Cmd+Q or the app menu. Closing the window only hides it."
                          : "Show a confirmation dialog when closing the app to prevent accidental data loss."}
                      </p>
                    </div>
                    <Checkbox
                      id="settings-confirm-quit"
                      checked={confirmOnClose}
                      onCheckedChange={(v) => setConfirmOnClose(v === true)}
                      className={settingsStyles.preferenceControl}
                    />
                  </div>
                </>
              ) : isWindows ? (
                <>
                  <div className={settingsStyles.preferenceRow}>
                    <div className={settingsStyles.stack0_5}>
                      <Label htmlFor="settings-show-dock" className={settingsStyles.cursorPointer}>Show in taskbar</Label>
                      <p className={settingsStyles.textXsMuted}>
                        Display the app in the Windows taskbar.
                        {!showTrayIcon && " Cannot be disabled while the tray icon is hidden."}
                      </p>
                    </div>
                    <Checkbox
                      id="settings-show-dock"
                      checked={!hideDockIcon}
                      disabled={!showTrayIcon}
                      onCheckedChange={(v) => setHideDockIcon(v !== true)}
                      className={settingsStyles.preferenceControl}
                    />
                  </div>
                  <div className={settingsStyles.preferenceRow}>
                    <div className={settingsStyles.stack0_5}>
                      <Label htmlFor="settings-show-tray" className={settingsStyles.cursorPointer}>Show in system tray</Label>
                      <p className={settingsStyles.textXsMuted}>
                        Display an icon in the system tray notification area.
                        {hideDockIcon && " Required while the app is hidden from the taskbar."}
                      </p>
                    </div>
                    <Checkbox
                      id="settings-show-tray"
                      checked={showTrayIcon}
                      disabled={hideDockIcon}
                      onCheckedChange={(v) => setShowTrayIcon(v === true)}
                      className={settingsStyles.preferenceControl}
                    />
                  </div>
                  <div className={settingsStyles.preferenceRow}>
                    <div className={settingsStyles.stack0_5}>
                      <Label htmlFor="settings-keep-running" className={clsx("cursor-pointer", !showTrayIcon && settingsStyles.labelMuted)}>
                        Minimize to tray on close
                      </Label>
                      <p className={settingsStyles.textXsMuted}>
                        {showTrayIcon
                          ? "Closing the window minimizes to the system tray instead of quitting."
                          : "Requires the system tray icon to be enabled."}
                      </p>
                    </div>
                    <Checkbox
                      id="settings-keep-running"
                      checked={minimizeToTray}
                      disabled={!showTrayIcon}
                      onCheckedChange={(v) => setMinimizeToTray(v === true)}
                      className={settingsStyles.preferenceControl}
                    />
                  </div>
                  <div className={settingsStyles.preferenceRow}>
                    <div className={settingsStyles.stack0_5}>
                      <Label htmlFor="settings-confirm-quit" className={settingsStyles.cursorPointer}>
                        Confirm before exit
                      </Label>
                      <p className={settingsStyles.textXsMuted}>
                        {minimizeToTray
                          ? "Show a confirmation when quitting from the tray menu. Closing the window only hides it."
                          : "Show a confirmation dialog when exiting the app."}
                      </p>
                    </div>
                    <Checkbox
                      id="settings-confirm-quit"
                      checked={confirmOnClose}
                      onCheckedChange={(v) => setConfirmOnClose(v === true)}
                      className={settingsStyles.preferenceControl}
                    />
                  </div>
                </>
              ) : (
                <div className={settingsStyles.p4TextXsMuted}>
                  Window behavior controls are currently optimized for macOS and Windows.
                </div>
              )}
            </div>

            {/* Backup & Restore */}
            <div className={settingsStyles.sectionIntro}>
              <h2 className={settingsStyles.textBaseSemibold}>Backup & Restore</h2>
              <p className={settingsStyles.textSmMuted}>
                Create a full app backup file or restore one to recover your full workspace state.
              </p>
            </div>
            <Paper className={clsx("ui-panel-shell", settingsStyles.panelShellP4Stack3)}>
              <input
                ref={backupFileInputRef}
                type="file"
                accept=".json,application/json"
                className={settingsStyles.hiddenInput}
                onChange={(e) => handleRestoreFilePicked(e.target.files?.[0] ?? null)}
              />
              <Group className={settingsStyles.wrapItemsGap2} gap="sm" align="center">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={backupBusy || restoreBusy}
                  onClick={handleCreateFullBackup}
                >
                  {backupBusy ? <Loader2 className={settingsStyles.iconSpinnerSmMr} /> : null}
                  Create Full Backup
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={backupBusy || restoreBusy}
                  onClick={() => backupFileInputRef.current?.click()}
                >
                  {restoreBusy ? <Loader2 className={settingsStyles.iconSpinnerSmMr} /> : null}
                  Restore Backup
                </Button>
              </Group>
              <p className={settingsStyles.textXsMuted}>
                Restore applies the backup immediately and persists it for the next launch.
              </p>
            </Paper>
            </div>
          </TabsContent>

          <TabsContent value="notifications" className={settingsStyles.tabsContentBase}>
            <NotificationSettings />
          </TabsContent>

          <TabsContent value="user-agent" className={settingsStyles.tabsContentP6Space6}>
            <div className={settingsStyles.sectionIntro}>
              <h2 className={settingsStyles.textBaseSemibold}>User-Agent Identity</h2>
              <p className={settingsStyles.textSmMuted}>
                Configure a global User-Agent and optional per-feature overrides where supported.
              </p>
            </div>

            <div className={clsx("ui-panel-shell", settingsStyles.panelShellRoundedContent)}>
              <p className={settingsStyles.textXsMuted}>
                Leave an override blank to inherit the global value. This keeps behavior consistent while still allowing targeted compatibility fixes.
              </p>
            </div>

            <Stack className={settingsStyles.stack3} gap="sm">
              <Label className={settingsStyles.textSmMedium}>Global preset</Label>
              <RadioGroup
                value={userAgent.preset}
                onValueChange={(v) => setUserAgentPreset(v as UserAgentPreset)}
                className={settingsStyles.gridGap2}
              >
                <label htmlFor="ua-default" className={settingsStyles.uaPresetOption}>
                  <RadioGroupItem value="default" id="ua-default" />
                  <div className={settingsStyles.stack1}>
                    <span className={settingsStyles.fontMedium}>Default</span>
                    <p className={settingsStyles.textXsMuted}>
                      SIPalyzer version + OS + username
                    </p>
                  </div>
                </label>
                <label htmlFor="ua-info" className={settingsStyles.uaPresetOption}>
                  <RadioGroupItem value="info" id="ua-info" />
                  <div className={settingsStyles.stack1}>
                    <span className={settingsStyles.fontMedium}>Info</span>
                    <p className={settingsStyles.textXsMuted}>
                      SIPalyzer version + OS only
                    </p>
                  </div>
                </label>
                <label htmlFor="ua-minimal" className={settingsStyles.uaPresetOption}>
                  <RadioGroupItem value="minimal" id="ua-minimal" />
                  <div className={settingsStyles.stack1}>
                    <span className={settingsStyles.fontMedium}>Minimal</span>
                    <p className={settingsStyles.textXsMuted}>
                      SIPalyzer + version only
                    </p>
                  </div>
                </label>
                <label htmlFor="ua-custom" className={settingsStyles.uaPresetOption}>
                  <RadioGroupItem value="custom" id="ua-custom" />
                  <div className={settingsStyles.stack1Flex1}>
                    <span className={settingsStyles.fontMedium}>Custom</span>
                    <p className={settingsStyles.textXsMuted}>
                      Use a custom User-Agent string
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </Stack>

            {userAgent.preset === "custom" && (
              <div className={settingsStyles.surfaceStack2P3}>
                <Label htmlFor="user-agent-custom">Custom User-Agent</Label>
                <Input
                  id="user-agent-custom"
                  value={userAgent.customValue}
                  onChange={(e) => setUserAgentCustomValue(e.target.value)}
                  placeholder="e.g. MyClient/1.0"
                  className={settingsStyles.monoTextSm}
                />
              </div>
            )}

            <Stack className={settingsStyles.stack3} gap="sm">
              <Label className={settingsStyles.textSmMedium}>Per-feature overrides</Label>
              <div className={settingsStyles.surfaceRoundedDivided}>
                {userAgentScopeRows.map((row) => (
                  <div key={row.scope} className={settingsStyles.p3Stack1_5}>
                    <div className={settingsStyles.rowBetweenGap2}>
                      <p className={settingsStyles.textSmMedium}>{row.label}</p>
                      <p className={settingsStyles.text2xsMuted}>
                        {userAgent.overrides?.[row.scope]?.trim() ? "Override" : "Inherit"}
                      </p>
                    </div>
                    <p className={settingsStyles.textXsMuted}>{row.description}</p>
                    <Input
                      value={userAgent.overrides?.[row.scope] ?? ""}
                      onChange={(e) => setUserAgentScopeOverride(row.scope, e.target.value)}
                      placeholder={row.placeholder}
                      className={settingsStyles.monoTextSm}
                    />
                  </div>
                ))}
              </div>
            </Stack>

            <div className={clsx("ui-panel-shell", settingsStyles.panelShellP4Stack2)}>
              <Label className={settingsStyles.sectionLabel}>Current value</Label>
              <p className={clsx(settingsStyles.uaPreview, preview ? settingsStyles.uaPreviewActive : settingsStyles.uaPreviewInactive)}>
                {preview || "—"}
              </p>
              <div className={settingsStyles.pt1Stack1TextXs}>
                <p className={settingsStyles.textMuted}>Composer HTTP: <span className={settingsStyles.monoTextForeground}>{scopePreview.composerHttp}</span></p>
                <p className={settingsStyles.textMuted}>Composer GraphQL: <span className={settingsStyles.monoTextForeground}>{scopePreview.composerGraphql}</span></p>
                <p className={settingsStyles.textMuted}>Composer SIP: <span className={settingsStyles.monoTextForeground}>{scopePreview.composerSip}</span></p>
                <p className={settingsStyles.textMuted}>Provision fetches: <span className={settingsStyles.monoTextForeground}>{scopePreview.provisionFetch}</span></p>
              </div>
            </div>

            <div className={settingsStyles.rowBetweenPt1}>
              <TooltipWrapper entry={tooltips.settingsResetDefaults}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    resetUserAgent();
                    resetUserAgentScopeOverrides();
                  }}
                >
                  <RotateCcw className={settingsStyles.iconMdMr} />
                  Reset all User-Agent settings
                </Button>
              </TooltipWrapper>
            </div>
          </TabsContent>

          <TabsContent value="packet-monitor" className={settingsStyles.tabsContentP6Space8}>
            <div className={settingsStyles.stack1_5}>
              <h2 className={settingsStyles.textBaseSemibold}>Packet Monitor</h2>
              <p className={settingsStyles.textSmMuted}>
                Capture engine, display behavior, and performance tuning for the packet monitor.
              </p>
            </div>

            {/* Capture Behavior */}
            <div className={settingsStyles.stack4}>
              <h3 className={settingsStyles.textSmSemibold}>Capture</h3>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellDivided)}>
                <div className={settingsStyles.rowBetweenP4}>
                  <div className={settingsStyles.stack0_5}>
                    <Label htmlFor="pm-pipeline-mode" className={settingsStyles.cursorPointer}>Pipeline mode (multi-threaded)</Label>
                    <p className={settingsStyles.textXsMuted}>High-throughput capture with dedicated parser threads. Recommended for 100k+ pps.</p>
                  </div>
                  <Checkbox
                    id="pm-pipeline-mode"
                    checked={pm.pipelineMode}
                    onCheckedChange={(v) => setPacketMonitor({ pipelineMode: v === true })}
                  />
                </div>
                <div className={settingsStyles.rowBetweenP4}>
                  <div className={settingsStyles.stack0_5}>
                    <Label htmlFor="pm-auto-scroll" className={settingsStyles.cursorPointer}>Auto-scroll to new packets</Label>
                    <p className={settingsStyles.textXsMuted}>Automatically scroll to the latest packet during live capture.</p>
                  </div>
                  <Checkbox
                    id="pm-auto-scroll"
                    checked={pm.autoScroll}
                    onCheckedChange={(v) => setPacketMonitor({ autoScroll: v === true })}
                  />
                </div>
              </div>
            </div>

            {/* Memory & Sessions */}
            <div className={settingsStyles.stack4}>
              <h3 className={settingsStyles.textSmSemibold}>Memory & Sessions</h3>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellGridGap4P4)}>
                <div className={settingsStyles.gridGap4Cols2}>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-ring-buffer">Ring buffer capacity</Label>
                    <AppDropdown
                      id="pm-ring-buffer"
                      value={String(pm.ringBufferCapacity)}
                      onValueChange={(v) => setPacketMonitor({ ringBufferCapacity: Number(v) })}
                      options={[
                        { value: "500000", label: "500K packets" },
                        { value: "1000000", label: "1M packets" },
                        { value: "2000000", label: "2M packets" },
                        { value: "5000000", label: "5M packets" },
                        { value: "10000000", label: "10M packets" },
                      ]}
                    />
                    <p className={settingsStyles.textXsMuted}>Max packets held in memory per session.</p>
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-stream-max">Live stream buffer</Label>
                    <AppDropdown
                      id="pm-stream-max"
                      value={String(pm.streamMaxPackets)}
                      onValueChange={(v) => setPacketMonitor({ streamMaxPackets: Number(v) })}
                      options={[
                        { value: "5000", label: "5K packets" },
                        { value: "10000", label: "10K packets" },
                        { value: "25000", label: "25K packets" },
                        { value: "50000", label: "50K packets" },
                        { value: "100000", label: "100K packets" },
                      ]}
                    />
                    <p className={settingsStyles.textXsMuted}>Max packets in the live streaming view.</p>
                  </div>
                </div>
                <div className={settingsStyles.gridGap4Cols2}>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-max-sessions">Max sessions in memory</Label>
                    <AppDropdown
                      id="pm-max-sessions"
                      value={String(pm.maxSessionsInMemory)}
                      onValueChange={(v) => setPacketMonitor({ maxSessionsInMemory: Number(v) })}
                      options={[3, 5, 10, 15, 20].map((n) => ({
                        value: String(n),
                        label: `${n} sessions`,
                      }))}
                    />
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-session-timeout">Session timeout</Label>
                    <AppDropdown
                      id="pm-session-timeout"
                      value={String(pm.sessionTimeoutSecs)}
                      onValueChange={(v) => setPacketMonitor({ sessionTimeoutSecs: Number(v) })}
                      options={[
                        { value: "300", label: "5 minutes" },
                        { value: "900", label: "15 minutes" },
                        { value: "1800", label: "30 minutes" },
                        { value: "3600", label: "1 hour" },
                        { value: "7200", label: "2 hours" },
                      ]}
                    />
                    <p className={settingsStyles.textXsMuted}>Evict stopped sessions after this time.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Polling & Display */}
            <div className={settingsStyles.stack4}>
              <h3 className={settingsStyles.textSmSemibold}>Polling & Display</h3>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellGridGap4P4)}>
                <div className={settingsStyles.gridGap4Cols3}>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-packet-poll">Packet poll interval</Label>
                    <AppDropdown
                      id="pm-packet-poll"
                      value={String(pm.packetPollIntervalMs)}
                      onValueChange={(v) => setPacketMonitor({ packetPollIntervalMs: Number(v) })}
                      options={[
                        { value: "100", label: "100ms" },
                        { value: "250", label: "250ms" },
                        { value: "500", label: "500ms" },
                        { value: "1000", label: "1s" },
                        { value: "2000", label: "2s" },
                      ]}
                    />
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-stats-poll">Stats poll interval</Label>
                    <AppDropdown
                      id="pm-stats-poll"
                      value={String(pm.statsPollIntervalMs)}
                      onValueChange={(v) => setPacketMonitor({ statsPollIntervalMs: Number(v) })}
                      options={[
                        { value: "500", label: "500ms" },
                        { value: "1000", label: "1s" },
                        { value: "2000", label: "2s" },
                        { value: "5000", label: "5s" },
                      ]}
                    />
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-page-size">Fetch page size</Label>
                    <AppDropdown
                      id="pm-page-size"
                      value={String(pm.pageSize)}
                      onValueChange={(v) => setPacketMonitor({ pageSize: Number(v) })}
                      options={[
                        { value: "1000", label: "1K" },
                        { value: "2500", label: "2.5K" },
                        { value: "5000", label: "5K" },
                        { value: "10000", label: "10K" },
                      ]}
                    />
                    <p className={settingsStyles.textXsMuted}>Packets per batch fetch.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pipeline Tuning */}
            <div className={settingsStyles.stack4}>
              <div className={settingsStyles.rowGap2}>
                <h3 className={settingsStyles.textSmSemibold}>Pipeline Tuning</h3>
                <span className={settingsStyles.textXsMuted}>Advanced</span>
              </div>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellGridGap4P4)}>
                <div className={settingsStyles.gridGap4Cols2}>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-raw-queue">Raw packet queue</Label>
                    <AppDropdown
                      id="pm-raw-queue"
                      value={String(pm.pipelineRawQueueSize)}
                      onValueChange={(v) => setPacketMonitor({ pipelineRawQueueSize: Number(v) })}
                      options={[
                        { value: "16384", label: "16K" },
                        { value: "32768", label: "32K" },
                        { value: "65536", label: "64K" },
                        { value: "131072", label: "128K" },
                        { value: "262144", label: "256K" },
                      ]}
                    />
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-parsed-queue">Parsed packet queue</Label>
                    <AppDropdown
                      id="pm-parsed-queue"
                      value={String(pm.pipelineParsedQueueSize)}
                      onValueChange={(v) => setPacketMonitor({ pipelineParsedQueueSize: Number(v) })}
                      options={[
                        { value: "8192", label: "8K" },
                        { value: "16384", label: "16K" },
                        { value: "32768", label: "32K" },
                        { value: "65536", label: "64K" },
                        { value: "131072", label: "128K" },
                      ]}
                    />
                  </div>
                </div>
                <div className={settingsStyles.gridGap4Cols2}>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-parser-threads">Parser threads</Label>
                    <AppDropdown
                      id="pm-parser-threads"
                      value={String(pm.pipelineParserThreads)}
                      onValueChange={(v) => setPacketMonitor({ pipelineParserThreads: Number(v) })}
                      options={[
                        { value: "0", label: "Auto (CPU cores)" },
                        { value: "1", label: "1 thread" },
                        { value: "2", label: "2 threads" },
                        { value: "4", label: "4 threads" },
                        { value: "8", label: "8 threads" },
                        { value: "16", label: "16 threads" },
                      ]}
                    />
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-write-batch">Write batch size</Label>
                    <AppDropdown
                      id="pm-write-batch"
                      value={String(pm.pipelineWriteBatchSize)}
                      onValueChange={(v) => setPacketMonitor({ pipelineWriteBatchSize: Number(v) })}
                      options={[
                        { value: "250", label: "250" },
                        { value: "500", label: "500" },
                        { value: "1000", label: "1,000" },
                        { value: "2500", label: "2,500" },
                        { value: "5000", label: "5,000" },
                      ]}
                    />
                    <p className={settingsStyles.textXsMuted}>Packets written per PCAP batch.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* RTP Detection */}
            <div className={settingsStyles.stack4}>
              <h3 className={settingsStyles.textSmSemibold}>RTP Detection</h3>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellP4)}>
                <div className={settingsStyles.gridGap4Cols2}>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-rtp-low">RTP port range (low)</Label>
                    <Input
                      id="pm-rtp-low"
                      type="number"
                      min="1024"
                      max="65535"
                      value={pm.rtpPortRangeLow}
                      onChange={(e) => setPacketMonitor({ rtpPortRangeLow: Math.max(1024, Math.min(65535, parseInt(e.target.value) || 10000)) })}
                      className={settingsStyles.monoTextSm}
                    />
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="pm-rtp-high">RTP port range (high)</Label>
                    <Input
                      id="pm-rtp-high"
                      type="number"
                      min="1024"
                      max="65535"
                      value={pm.rtpPortRangeHigh}
                      onChange={(e) => setPacketMonitor({ rtpPortRangeHigh: Math.max(1024, Math.min(65535, parseInt(e.target.value) || 60000)) })}
                      className={settingsStyles.monoTextSm}
                    />
                  </div>
                </div>
                <p className={settingsStyles.textXsMutedMt3}>
                  UDP ports in this range are classified as RTP for stream detection and quality analysis.
                </p>
              </div>
            </div>

            <div className={settingsStyles.pt2}>
              <TooltipWrapper entry={tooltips.settingsResetDefaults}>
                <Button variant="secondary" size="sm" onClick={resetPacketMonitor}>
                  <RotateCcw className={settingsStyles.iconMdMr} />
                  Reset all to defaults
                </Button>
              </TooltipWrapper>
            </div>
          </TabsContent>

          <TabsContent value="fax" className={settingsStyles.tabsContentP6Space8}>
            <div className={settingsStyles.stack1_5}>
              <h2 className={settingsStyles.textBaseSemibold}>Fax Settings</h2>
              <p className={settingsStyles.textSmMuted}>
                T.30 / T.38 options for sending and receiving faxes.
              </p>
            </div>

            {/* Shared media allocation */}
            <div className={settingsStyles.stack4}>
              <h3 className={settingsStyles.textSmSemibold}>Media Port Range (Shared)</h3>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellP4)}>
                <div className={settingsStyles.gridGap4Cols2}>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="fax-media-range-low">RTP/UDPTL range (low)</Label>
                    <Input
                      id="fax-media-range-low"
                      type="number"
                      min="1024"
                      max="65535"
                      value={mediaPorts.rangeLow}
                      onChange={(e) =>
                        setMediaPorts({
                          rangeLow: Math.max(1024, Math.min(65535, parseInt(e.target.value, 10) || 10000)),
                        })
                      }
                      className={settingsStyles.monoTextSm}
                    />
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="fax-media-range-high">RTP/UDPTL range (high)</Label>
                    <Input
                      id="fax-media-range-high"
                      type="number"
                      min="1024"
                      max="65535"
                      value={mediaPorts.rangeHigh}
                      onChange={(e) =>
                        setMediaPorts({
                          rangeHigh: Math.max(1024, Math.min(65535, parseInt(e.target.value, 10) || 65500)),
                        })
                      }
                      className={settingsStyles.monoTextSm}
                    />
                  </div>
                </div>
                <p className={settingsStyles.textXsMutedMt3}>
                  Shared allocation used by both Fax Center and Soft Phone media sessions.
                </p>
              </div>
            </div>

            {/* Send & Receive Section */}
            <div className={settingsStyles.stack4}>
              <div className={settingsStyles.rowGap2}>
                <h3 className={settingsStyles.textSmSemibold}>Send & Receive (T.30)</h3>
                <span className={settingsStyles.textXsMuted}>Common options</span>
              </div>
              
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellGridGap4P4)}>
                <div className={settingsStyles.rowBetween}>
                  <div className={settingsStyles.stack0_5}>
                    <Label htmlFor="fax-settings-ecm" className={settingsStyles.cursorPointer}>ECM (Error Correction Mode)</Label>
                    <p className={settingsStyles.textXsMuted}>Reduces errors over poor lines</p>
                  </div>
                  <Checkbox
                    id="fax-settings-ecm"
                    checked={faxSafe.ecm}
                    onCheckedChange={(v) => setFax({ ecm: v === true })}
                  />
                </div>
                <div className={settingsStyles.rowBetween}>
                  <div className={settingsStyles.stack0_5}>
                    <Label htmlFor="fax-settings-g711-only" className={settingsStyles.cursorPointer}>Use G.711 only (no T.38)</Label>
                    <p className={settingsStyles.textXsMuted}>Send fax over G.711 audio only</p>
                  </div>
                  <Checkbox
                    id="fax-settings-g711-only"
                    checked={faxSafe.useG711Only}
                    onCheckedChange={(v) => setFax({ useG711Only: v === true })}
                  />
                </div>
                <div className={settingsStyles.gridGap4Cols2Pt2}>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="fax-settings-baud">Baud rate</Label>
                    <AppDropdown
                      id="fax-settings-baud"
                      value={String(faxSafe.baudRate)}
                      onValueChange={(v) => setFax({ baudRate: Number(v) })}
                      options={FAX_BAUD_RATES.map((r) => ({
                        value: String(r),
                        label: `${r} baud`,
                      }))}
                    />
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="fax-settings-resolution">Resolution</Label>
                    <AppDropdown
                      id="fax-settings-resolution"
                      value={faxSafe.resolution}
                      onValueChange={(v) => setFax({ resolution: v as FaxResolution })}
                      options={[
                        { value: "standard", label: "Standard (204×98 lpi)" },
                        { value: "fine", label: "Fine (204×196 lpi)" },
                      ]}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Send Section */}
            <div className={settingsStyles.stack4}>
              <h3 className={settingsStyles.textSmSemibold}>Send</h3>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellGridGap4Cols3P4)}>
                <div className={settingsStyles.stack2}>
                  <Label htmlFor="fax-settings-send-retries">Max retries</Label>
                  <AppDropdown
                    id="fax-settings-send-retries"
                    value={String(faxSafe.sendRetries)}
                    onValueChange={(v) => setFax({ sendRetries: Number(v) })}
                    options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
                  />
                </div>
                <div className={settingsStyles.stack2}>
                  <Label htmlFor="fax-settings-dis-timeout">DIS timeout</Label>
                  <AppDropdown
                    id="fax-settings-dis-timeout"
                    value={String(faxSafe.disTimeoutSecs)}
                    onValueChange={(v) => setFax({ disTimeoutSecs: Number(v) })}
                    options={[5, 10, 15, 20, 25, 30].map((n) => ({
                      value: String(n),
                      label: `${n}s`,
                    }))}
                  />
                </div>
                <div className={settingsStyles.stack2}>
                  <Label htmlFor="fax-settings-mcf-timeout">MCF timeout</Label>
                  <AppDropdown
                    id="fax-settings-mcf-timeout"
                    value={String(faxSafe.mcfTimeoutSecs)}
                    onValueChange={(v) => setFax({ mcfTimeoutSecs: Number(v) })}
                    options={[5, 10, 15, 20, 25, 30].map((n) => ({
                      value: String(n),
                      label: `${n}s`,
                    }))}
                  />
                </div>
              </div>
            </div>

            {/* Receive Section */}
            <div className={settingsStyles.stack4}>
              <h3 className={settingsStyles.textSmSemibold}>Receive</h3>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellGridGap4P4)}>
                <div className={settingsStyles.gridGap4Cols2}>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="fax-settings-receive-timeout">Receive timeout</Label>
                    <AppDropdown
                      id="fax-settings-receive-timeout"
                      value={String(faxSafe.receiveTimeoutSecs)}
                      onValueChange={(v) => setFax({ receiveTimeoutSecs: Number(v) })}
                      options={[30, 60, 90, 120, 180, 240, 300].map((n) => ({
                        value: String(n),
                        label: `${n}s`,
                      }))}
                    />
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="fax-settings-auto-answer">Auto-answer after</Label>
                    <AppDropdown
                      id="fax-settings-auto-answer"
                      value={String(faxSafe.autoAnswerRings)}
                      onValueChange={(v) => setFax({ autoAnswerRings: Number(v) })}
                      options={[
                        { value: "0", label: "Manual only" },
                        ...[1, 2, 3, 4, 5].map((n) => ({
                          value: String(n),
                          label: `${n} ring${n !== 1 ? "s" : ""}`,
                        })),
                      ]}
                    />
                  </div>
                </div>
                <div className={settingsStyles.stack2}>
                  <Label htmlFor="fax-settings-save-folder">Save received to folder</Label>
                  <Input
                    id="fax-settings-save-folder"
                    value={faxSafe.saveReceivedToFolder}
                    onChange={(e) => setFax({ saveReceivedToFolder: e.target.value })}
                    placeholder="Leave empty for app only"
                    className={settingsStyles.monoTextSm}
                  />
                  <p className={settingsStyles.textXsMuted}>
                    Optional folder path. Empty = store in app only.
                  </p>
                </div>
              </div>
            </div>

            <div className={settingsStyles.pt2}>
              <TooltipWrapper entry={tooltips.settingsResetDefaults}>
                <Button variant="secondary" size="sm" onClick={resetFax}>
                  <RotateCcw className={settingsStyles.iconMdMr} />
                  Reset all to defaults
                </Button>
              </TooltipWrapper>
            </div>
          </TabsContent>

          <TabsContent value="terminal" className={settingsStyles.tabsContentP6Space8}>
            <div className={settingsStyles.stack1_5}>
              <h2 className={settingsStyles.textBaseSemibold}>Terminal</h2>
              <p className={settingsStyles.textSmMuted}>
                Appearance and behavior settings for the built-in terminal emulator.
              </p>
            </div>

            {/* Appearance */}
            <div className={settingsStyles.stack4}>
              <h3 className={settingsStyles.textSmSemibold}>Appearance</h3>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellGridGap4P4)}>
                <div className={settingsStyles.gridGap4Cols2}>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="term-font-size">Font size</Label>
                    <AppDropdown
                      id="term-font-size"
                      value={String(terminalSettings.fontSize)}
                      onValueChange={(v) => setTerminal({ fontSize: Number(v) })}
                      options={[10, 11, 12, 13, 14, 15, 16, 18, 20].map((s) => ({
                        value: String(s),
                        label: `${s}px`,
                      }))}
                    />
                  </div>
                  <div className={settingsStyles.stack2}>
                    <Label htmlFor="term-line-height">Line height</Label>
                    <AppDropdown
                      id="term-line-height"
                      value={String(terminalSettings.lineHeight)}
                      onValueChange={(v) => setTerminal({ lineHeight: Number(v) })}
                      options={[1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0].map((h) => ({
                        value: String(h),
                        label: String(h),
                      }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Cursor */}
            <div className={settingsStyles.stack4}>
              <h3 className={settingsStyles.textSmSemibold}>Cursor</h3>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellDivided)}>
                <div className={settingsStyles.p4Stack2}>
                  <Label htmlFor="term-cursor-style">Cursor style</Label>
                  <AppDropdown
                    id="term-cursor-style"
                    className={settingsStyles.wFullSm48}
                    value={terminalSettings.cursorStyle}
                    onValueChange={(v) => setTerminal({ cursorStyle: v as TerminalCursorStyle })}
                    options={[
                      { value: "bar", label: "Bar (|)" },
                      { value: "block", label: "Block (█)" },
                      { value: "underline", label: "Underline (_)" },
                    ]}
                  />
                </div>
                <div className={settingsStyles.rowBetweenP4}>
                  <div className={settingsStyles.stack0_5}>
                    <Label htmlFor="term-cursor-blink" className={settingsStyles.cursorPointer}>Blinking cursor</Label>
                    <p className={settingsStyles.textXsMuted}>Animate the terminal cursor.</p>
                  </div>
                  <Checkbox
                    id="term-cursor-blink"
                    checked={terminalSettings.cursorBlink}
                    onCheckedChange={(v) => setTerminal({ cursorBlink: v === true })}
                  />
                </div>
              </div>
            </div>

            {/* Behavior */}
            <div className={settingsStyles.stack4}>
              <h3 className={settingsStyles.textSmSemibold}>Behavior</h3>
              <div className={clsx("ui-panel-shell", settingsStyles.panelShellDivided)}>
                <div className={settingsStyles.p4Stack2}>
                  <Label htmlFor="term-scrollback">Scrollback buffer</Label>
                  <AppDropdown
                    id="term-scrollback"
                    className={settingsStyles.wFullSm48}
                    value={String(terminalSettings.scrollback)}
                    onValueChange={(v) => setTerminal({ scrollback: Number(v) })}
                    options={[
                      { value: "1000", label: "1,000 lines" },
                      { value: "5000", label: "5,000 lines" },
                      { value: "10000", label: "10,000 lines" },
                      { value: "25000", label: "25,000 lines" },
                      { value: "50000", label: "50,000 lines" },
                      { value: "100000", label: "100,000 lines" },
                    ]}
                  />
                  <p className={settingsStyles.textXsMuted}>
                    Number of lines kept in the scroll history. Higher values use more memory.
                  </p>
                </div>
                <div className={settingsStyles.rowBetweenP4}>
                  <div className={settingsStyles.stack0_5}>
                    <Label htmlFor="term-confirm-close" className={settingsStyles.cursorPointer}>Confirm before closing</Label>
                    <p className={settingsStyles.textXsMuted}>Show a confirmation dialog when closing the terminal window. All active sessions will be terminated.</p>
                  </div>
                  <Checkbox
                    id="term-confirm-close"
                    checked={terminalSettings.confirmOnClose}
                    onCheckedChange={(v) => setTerminal({ confirmOnClose: v === true })}
                  />
                </div>
              </div>
            </div>

            <div className={settingsStyles.pt2}>
              <TooltipWrapper entry={tooltips.settingsResetDefaults}>
                <Button variant="secondary" size="sm" onClick={resetTerminal}>
                  <RotateCcw className={settingsStyles.iconMdMr} />
                  Reset all to defaults
                </Button>
              </TooltipWrapper>
            </div>
          </TabsContent>

          <TabsContent value="soft-phone" className={settingsStyles.tabsContentBase}>
            <Suspense
              fallback={
                <div className={settingsStyles.centerPy12}>
                  <Loader2 className={settingsStyles.iconSpinnerLgMuted} />
                </div>
              }
            >
              <SoftphoneSettingsView />
            </Suspense>
          </TabsContent>

        </Tabs>
      </div>

      <AdminPasswordDialog
        open={adminDialogOpen}
        onClose={() => setAdminDialogOpen(false)}
        mode={adminDialogMode}
        onSuccess={handleAdminSuccess}
      />
    </>
  );
}

