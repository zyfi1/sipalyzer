import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { useSettingsStore, UserAgentPreset, type UserAgentScope, type TimeFormatSetting, type DateFormatSetting, type TemperatureUnit, type TerminalCursorStyle } from "@/stores/settingsStore";
import { useLayoutStore, type SettingsCenterTab } from "@/stores/layoutStore";
import { NotificationSettings } from "@/components/notifications/NotificationSettings";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RotateCcw, X, Shield, Info, MapPin, Loader2, AppleLogo, WindowsLogo, Package } from "@/lib/icons";
import { AdminPasswordDialog } from "@/components/admin/AdminPasswordDialog";
import { navigateTo } from "@/lib/navigation";
import { fetchUrl } from "@/api/provision";
import { exportFullAppBackup, restoreFullAppBackupFromText, auditBackupRestoreFailure } from "@/lib/appBackup";

import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { Checkbox } from "@/components/ui/checkbox";
import { useNotificationStore } from "@/stores/notificationStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FAX_BAUD_RATES } from "@/api/fax";
import type { FaxResolution, FaxSettings, PacketMonitorSettings } from "@/stores/settingsStore";
import { APP_TIMEZONE_OPTIONS } from "@/lib/dateTime";
const SettingsAboutPanel = lazy(() =>
  import("./SettingsAboutPanel").then((m) => ({ default: m.SettingsAboutPanel })),
);
const SoftphoneSettingsView = lazy(() =>
  import("@/components/soft-phone/SettingsView").then((m) => ({ default: m.SettingsView })),
);
const AdminInventoryView = lazy(() =>
  import("@/components/admin/AdminInventoryView").then((m) => ({ default: m.AdminInventoryView })),
);


interface LocationSuggestion {
  /** Friendly label shown in the dropdown */
  display: string;
  /** Short value stored & sent to wttr.in (city or city, country) */
  query: string;
  lat: number;
  lon: number;
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
    <div ref={containerRef} className="relative">
      <div className="relative">
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
          className="pr-8"
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40">
          {searching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MapPin className="h-3.5 w-3.5" />
          )}
        </div>
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full ui-floating-surface rounded-md overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={`${s.display}-${i}`}
              type="button"
              className={cn(
                "w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2",
                i === highlightIdx
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/50 text-foreground/80",
              )}
              onMouseEnter={() => setHighlightIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s.query);
                setWeatherCoords(s.lat, s.lon);
              }}
            >
              <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/50" />
              <span className="truncate">{s.display}</span>
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

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 top-9 bg-black/50 z-40 transition-smooth"
        onClick={onClose}
      />
      <div
        className={cn(
          "fixed top-9 right-0 h-[calc(100%-2.25rem)] w-full max-w-[980px] bg-card border-l border-border z-50",
          "flex flex-col shadow-elevated transition-smooth",
          "animate-in slide-in-from-right duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]"
        )}
      >
        <Tabs
          value={settingsCenterTab}
          onValueChange={(v) => setSettingsCenterTab(v as SettingsCenterTab)}
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          {/* Header with top-level tabs */}
          <header className="ui-section-header-md flex items-end justify-between gap-3 px-3 pt-2 pb-0">
            <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
              <TabsList className="settings-nav-tabs min-w-max">
                <TooltipWrapper entry={tooltips.settingsGeneral}>
                  <TabsTrigger value="general" className="settings-nav-tab">
                    General
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsNotifications}>
                  <TabsTrigger value="notifications" className="settings-nav-tab">
                    Notifications
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsUserAgent}>
                  <TabsTrigger value="user-agent" className="settings-nav-tab">
                    User-Agent
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsPacketMonitor}>
                  <TabsTrigger value="packet-monitor" className="settings-nav-tab">
                    Packet Monitor
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsFax}>
                  <TabsTrigger value="fax" className="settings-nav-tab">
                    Fax
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsTerminal}>
                  <TabsTrigger value="terminal" className="settings-nav-tab">
                    Terminal
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.settingsSoftPhone}>
                  <TabsTrigger value="soft-phone" className="settings-nav-tab">
                    Soft Phone
                  </TabsTrigger>
                </TooltipWrapper>
                <TooltipWrapper content="Tools and license inventory">
                  <TabsTrigger value="inventory" className="settings-nav-tab">
                    Inventory
                  </TabsTrigger>
                </TooltipWrapper>
              </TabsList>
            </div>
            <div className="flex items-center gap-1 pb-1 shrink-0">
              <TooltipWrapper entry={tooltips.settingsAdmin}>
                <Button variant="neutral" size="icon" onClick={handleAdminClick} className="h-8 w-8" aria-label="Admin">
                  <Shield className="h-4 w-4" />
                </Button>
              </TooltipWrapper>
              <TooltipWrapper content="About SIPalyzer">
                <Button
                  variant={aboutOpen ? "neutral" : "ghost"}
                  size="icon"
                  onClick={() => setAboutOpen((o) => !o)}
                  className="h-8 w-8"
                  aria-label="About SIPalyzer"
                >
                  <Info className="h-4 w-4" />
                </Button>
              </TooltipWrapper>
              <TooltipWrapper content="Close settings">
                <Button variant="neutral" size="icon" onClick={onClose} className="h-8 w-8" aria-label="Close settings">
                  <X className="h-4 w-4" />
                </Button>
              </TooltipWrapper>
            </div>
          </header>

          {aboutOpen && (
            <Suspense
              fallback={
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-card">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <SettingsAboutPanel onClose={() => setAboutOpen(false)} />
            </Suspense>
          )}

          <TabsContent value="general" className="flex-1 overflow-y-auto mt-0 p-6 space-y-6">
            <div className="space-y-1.5 mb-2">
              <h2 className="text-base font-semibold">Date & time</h2>
              <p className="text-sm text-muted-foreground">
                All timestamps in the app are shown in this timezone and format.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="settings-timezone">Time zone</Label>
                <Select
                  value={timezone === "" ? "local" : timezone}
                  onValueChange={(v) => setTimezone(v === "local" ? "" : v)}
                >
                  <SelectTrigger id="settings-timezone" className="w-full">
                    <SelectValue placeholder="Local (system)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Local (system)</SelectItem>
                    {APP_TIMEZONE_OPTIONS.filter((o) => o.value !== "").map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-time-format">Time format</Label>
                <Select
                  value={timeFormat}
                  onValueChange={(v) => setTimeFormat(v as TimeFormatSetting)}
                >
                  <SelectTrigger id="settings-time-format" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">24-hour (e.g. 14:30)</SelectItem>
                    <SelectItem value="12h">12-hour AM/PM (e.g. 2:30 PM)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-date-format">Date format</Label>
                <Select
                  value={dateFormat}
                  onValueChange={(v) => setDateFormat(v as DateFormatSetting)}
                >
                  <SelectTrigger id="settings-date-format" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System default</SelectItem>
                    <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (US)</SelectItem>
                    <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (UK/EU)</SelectItem>
                    <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (ISO)</SelectItem>
                    <SelectItem value="DD.MM.YYYY">DD.MM.YYYY (DE)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-temp-unit">Temperature unit</Label>
                <Select
                  value={temperatureUnit}
                  onValueChange={(v) => setTemperatureUnit(v as TemperatureUnit)}
                >
                  <SelectTrigger id="settings-temp-unit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="celsius">Celsius (°C)</SelectItem>
                    <SelectItem value="fahrenheit">Fahrenheit (°F)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Weather */}
            <div className="space-y-1.5 mb-2">
              <h2 className="text-base font-semibold">Weather</h2>
              <p className="text-sm text-muted-foreground">
                Set a location for the home screen weather display. Leave empty to auto-detect.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="settings-weather-location">Location</Label>
                <WeatherLocationInput
                  value={weatherLocation}
                  onChange={setWeatherLocation}
                />
                <p className="text-xs text-muted-foreground">
                  City name, ZIP code, or coordinates (e.g. "New York", "10001", "40.7,-74.0").
                  Press Enter or click away to apply.
                </p>
              </div>
            </div>

            {/* Visibility */}
            <div className="space-y-1.5 mb-2">
              <h2 className="text-base font-semibold">Visibility</h2>
              <p className="text-sm text-muted-foreground">
                Improve readability in bright or high-glare environments.
              </p>
            </div>
            <div className="ui-panel-shell overflow-hidden divide-y divide-border/30">
              <div className="flex items-center justify-between p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="settings-high-visibility" className="cursor-pointer">
                    High visibility mode
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Boost contrast, strengthen borders, and reduce transparency app-wide.
                  </p>
                </div>
                <Checkbox
                  id="settings-high-visibility"
                  checked={highVisibility}
                  onCheckedChange={(v) => setHighVisibility(v === true)}
                />
              </div>
            </div>

            {/* Window Behavior */}
            <div className="space-y-1.5 mb-2">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Window Behavior</h2>
                {(isMac || isWindows) && (
                  isMac ? (
                    <AppleLogo className="h-3.5 w-3.5 text-muted-foreground" aria-label="macOS settings" />
                  ) : (
                    <WindowsLogo className="h-3.5 w-3.5 text-muted-foreground" aria-label="Windows settings" />
                  )
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {isMac
                  ? "Configure Dock/menu bar presence and quit behavior for macOS."
                  : isWindows
                    ? "Configure taskbar/system tray presence and close behavior for Windows."
                    : "Control how the app appears in the system and behaves when closing."}
              </p>
            </div>
            <div className="ui-panel-shell overflow-hidden divide-y divide-border/30">
              {isMac ? (
                <>
                  <div className="flex items-center justify-between p-4">
                    <div className="space-y-0.5">
                      <Label className="cursor-default">App visibility</Label>
                      <p className="text-xs text-muted-foreground">
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
                      className="grid grid-cols-3 gap-1 rounded-md border border-border/50 bg-muted/20 p-1"
                      aria-label="macOS app visibility"
                    >
                      <div className={cn(
                        "flex items-center gap-1.5 rounded border border-transparent px-2 py-1.5",
                        macVisibilityMode === "dock" && "bg-card border-border/60",
                      )}>
                        <RadioGroupItem id="settings-mac-visibility-dock" value="dock" />
                        <Label htmlFor="settings-mac-visibility-dock" className="cursor-pointer text-xs">Dock</Label>
                      </div>
                      <div className={cn(
                        "flex items-center gap-1.5 rounded border border-transparent px-2 py-1.5",
                        macVisibilityMode === "menu-bar" && "bg-card border-border/60",
                      )}>
                        <RadioGroupItem id="settings-mac-visibility-menu" value="menu-bar" />
                        <Label htmlFor="settings-mac-visibility-menu" className="cursor-pointer text-xs">Menu Bar</Label>
                      </div>
                      <div className={cn(
                        "flex items-center gap-1.5 rounded border border-transparent px-2 py-1.5",
                        macVisibilityMode === "both" && "bg-card border-border/60",
                      )}>
                        <RadioGroupItem id="settings-mac-visibility-both" value="both" />
                        <Label htmlFor="settings-mac-visibility-both" className="cursor-pointer text-xs">Both</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="settings-keep-running" className="cursor-pointer">
                        Keep app running when window closes
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Closing the window keeps the app running in the background. Reopen from Dock or menu bar.
                      </p>
                    </div>
                    <Checkbox
                      id="settings-keep-running"
                      checked={minimizeToTray}
                      onCheckedChange={(v) => setMinimizeToTray(v === true)}
                    />
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="settings-confirm-quit" className="cursor-pointer">
                        Confirm before quit (Cmd+Q)
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {minimizeToTray
                          ? "Show a confirmation when quitting from Cmd+Q or the app menu. Closing the window only hides it."
                          : "Show a confirmation dialog when closing the app to prevent accidental data loss."}
                      </p>
                    </div>
                    <Checkbox
                      id="settings-confirm-quit"
                      checked={confirmOnClose}
                      onCheckedChange={(v) => setConfirmOnClose(v === true)}
                    />
                  </div>
                </>
              ) : isWindows ? (
                <>
                  <div className="flex items-center justify-between p-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="settings-show-dock" className="cursor-pointer">Show in taskbar</Label>
                      <p className="text-xs text-muted-foreground">
                        Display the app in the Windows taskbar.
                        {!showTrayIcon && " Cannot be disabled while the tray icon is hidden."}
                      </p>
                    </div>
                    <Checkbox
                      id="settings-show-dock"
                      checked={!hideDockIcon}
                      disabled={!showTrayIcon}
                      onCheckedChange={(v) => setHideDockIcon(v !== true)}
                    />
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="settings-show-tray" className="cursor-pointer">Show in system tray</Label>
                      <p className="text-xs text-muted-foreground">
                        Display an icon in the system tray notification area.
                        {hideDockIcon && " Required while the app is hidden from the taskbar."}
                      </p>
                    </div>
                    <Checkbox
                      id="settings-show-tray"
                      checked={showTrayIcon}
                      disabled={hideDockIcon}
                      onCheckedChange={(v) => setShowTrayIcon(v === true)}
                    />
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="settings-keep-running" className={cn("cursor-pointer", !showTrayIcon && "text-muted-foreground")}>
                        Minimize to tray on close
                      </Label>
                      <p className="text-xs text-muted-foreground">
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
                    />
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="settings-confirm-quit" className="cursor-pointer">
                        Confirm before exit
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {minimizeToTray
                          ? "Show a confirmation when quitting from the tray menu. Closing the window only hides it."
                          : "Show a confirmation dialog when exiting the app."}
                      </p>
                    </div>
                    <Checkbox
                      id="settings-confirm-quit"
                      checked={confirmOnClose}
                      onCheckedChange={(v) => setConfirmOnClose(v === true)}
                    />
                  </div>
                </>
              ) : (
                <div className="p-4 text-xs text-muted-foreground">
                  Window behavior controls are currently optimized for macOS and Windows.
                </div>
              )}
            </div>

            {/* Backup & Restore */}
            <div className="space-y-1.5 mb-2">
              <h2 className="text-base font-semibold">Backup & Restore</h2>
              <p className="text-sm text-muted-foreground">
                Create a full app backup file or restore one to recover your full workspace state.
              </p>
            </div>
            <div className="ui-panel-shell p-4 space-y-3">
              <input
                ref={backupFileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => handleRestoreFilePicked(e.target.files?.[0] ?? null)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="neutral"
                  size="sm"
                  disabled={backupBusy || restoreBusy}
                  onClick={handleCreateFullBackup}
                >
                  {backupBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Create Full Backup
                </Button>
                <Button
                  variant="neutral"
                  size="sm"
                  disabled={backupBusy || restoreBusy}
                  onClick={() => backupFileInputRef.current?.click()}
                >
                  {restoreBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Restore Backup
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Restore applies the backup immediately and persists it for the next launch.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="notifications" className="flex-1 overflow-y-auto mt-0">
            <NotificationSettings />
          </TabsContent>

          <TabsContent value="user-agent" className="flex-1 overflow-y-auto mt-0 p-6 space-y-6">
            <div className="space-y-1.5 mb-2">
              <h2 className="text-base font-semibold">User-Agent Identity</h2>
              <p className="text-sm text-muted-foreground">
                Configure a global User-Agent and optional per-feature overrides where supported.
              </p>
            </div>

            <div className="ui-panel-shell rounded-md px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Leave an override blank to inherit the global value. This keeps behavior consistent while still allowing targeted compatibility fixes.
              </p>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-medium">Global preset</Label>
              <RadioGroup
                value={userAgent.preset}
                onValueChange={(v) => setUserAgentPreset(v as UserAgentPreset)}
                className="grid gap-2"
              >
                <label htmlFor="ua-default" className="flex items-start gap-3 rounded-md surface p-3 cursor-pointer hover:bg-muted/40 transition-smooth has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
                  <RadioGroupItem value="default" id="ua-default" className="mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-medium">Default</span>
                    <p className="text-xs text-muted-foreground">
                      SIPalyzer version + OS + username
                    </p>
                  </div>
                </label>
                <label htmlFor="ua-info" className="flex items-start gap-3 rounded-md surface p-3 cursor-pointer hover:bg-muted/40 transition-smooth has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
                  <RadioGroupItem value="info" id="ua-info" className="mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-medium">Info</span>
                    <p className="text-xs text-muted-foreground">
                      SIPalyzer version + OS only
                    </p>
                  </div>
                </label>
                <label htmlFor="ua-minimal" className="flex items-start gap-3 rounded-md surface p-3 cursor-pointer hover:bg-muted/40 transition-smooth has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
                  <RadioGroupItem value="minimal" id="ua-minimal" className="mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-medium">Minimal</span>
                    <p className="text-xs text-muted-foreground">
                      SIPalyzer + version only
                    </p>
                  </div>
                </label>
                <label htmlFor="ua-custom" className="flex items-start gap-3 rounded-md surface p-3 cursor-pointer hover:bg-muted/40 transition-smooth has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
                  <RadioGroupItem value="custom" id="ua-custom" className="mt-0.5" />
                  <div className="space-y-1 flex-1">
                    <span className="font-medium">Custom</span>
                    <p className="text-xs text-muted-foreground">
                      Use a custom User-Agent string
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>

            {userAgent.preset === "custom" && (
              <div className="space-y-2 rounded-md surface p-3">
                <Label htmlFor="user-agent-custom">Custom User-Agent</Label>
                <Input
                  id="user-agent-custom"
                  value={userAgent.customValue}
                  onChange={(e) => setUserAgentCustomValue(e.target.value)}
                  placeholder="e.g. MyClient/1.0"
                  className="font-mono text-sm"
                />
              </div>
            )}

            <div className="space-y-3">
              <Label className="text-sm font-medium">Per-feature overrides</Label>
              <div className="rounded-md surface divide-y divide-border/30">
                {userAgentScopeRows.map((row) => (
                  <div key={row.scope} className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{row.label}</p>
                      <p className="text-2xs text-muted-foreground">
                        {userAgent.overrides?.[row.scope]?.trim() ? "Override" : "Inherit"}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">{row.description}</p>
                    <Input
                      value={userAgent.overrides?.[row.scope] ?? ""}
                      onChange={(e) => setUserAgentScopeOverride(row.scope, e.target.value)}
                      placeholder={row.placeholder}
                      className="font-mono text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="ui-panel-shell p-4 space-y-2">
              <Label className="section-label">Current value</Label>
              <p className={cn("font-mono text-sm break-all", preview ? "text-foreground" : "text-muted-foreground")}>
                {preview || "—"}
              </p>
              <div className="pt-1 space-y-1 text-xs">
                <p className="text-muted-foreground">Composer HTTP: <span className="font-mono text-foreground">{scopePreview.composerHttp}</span></p>
                <p className="text-muted-foreground">Composer GraphQL: <span className="font-mono text-foreground">{scopePreview.composerGraphql}</span></p>
                <p className="text-muted-foreground">Composer SIP: <span className="font-mono text-foreground">{scopePreview.composerSip}</span></p>
                <p className="text-muted-foreground">Provision fetches: <span className="font-mono text-foreground">{scopePreview.provisionFetch}</span></p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <TooltipWrapper entry={tooltips.settingsResetDefaults}>
                <Button
                  variant="neutral"
                  size="sm"
                  onClick={() => {
                    resetUserAgent();
                    resetUserAgentScopeOverrides();
                  }}
                >
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                  Reset all User-Agent settings
                </Button>
              </TooltipWrapper>
            </div>
          </TabsContent>

          <TabsContent value="packet-monitor" className="flex-1 overflow-y-auto mt-0 p-6 space-y-8">
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold">Packet Monitor</h2>
              <p className="text-sm text-muted-foreground">
                Capture engine, display behavior, and performance tuning for the packet monitor.
              </p>
            </div>

            {/* Capture Behavior */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Capture</h3>
              <div className="ui-panel-shell divide-y divide-border/30">
                <div className="flex items-center justify-between p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="pm-pipeline-mode" className="cursor-pointer">Pipeline mode (multi-threaded)</Label>
                    <p className="text-xs text-muted-foreground">High-throughput capture with dedicated parser threads. Recommended for 100k+ pps.</p>
                  </div>
                  <Checkbox
                    id="pm-pipeline-mode"
                    checked={pm.pipelineMode}
                    onCheckedChange={(v) => setPacketMonitor({ pipelineMode: v === true })}
                  />
                </div>
                <div className="flex items-center justify-between p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="pm-auto-scroll" className="cursor-pointer">Auto-scroll to new packets</Label>
                    <p className="text-xs text-muted-foreground">Automatically scroll to the latest packet during live capture.</p>
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
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Memory & Sessions</h3>
              <div className="ui-panel-shell grid gap-4 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pm-ring-buffer">Ring buffer capacity</Label>
                    <Select
                      value={String(pm.ringBufferCapacity)}
                      onValueChange={(v) => setPacketMonitor({ ringBufferCapacity: Number(v) })}
                    >
                      <SelectTrigger id="pm-ring-buffer">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="500000">500K packets</SelectItem>
                        <SelectItem value="1000000">1M packets</SelectItem>
                        <SelectItem value="2000000">2M packets</SelectItem>
                        <SelectItem value="5000000">5M packets</SelectItem>
                        <SelectItem value="10000000">10M packets</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Max packets held in memory per session.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pm-stream-max">Live stream buffer</Label>
                    <Select
                      value={String(pm.streamMaxPackets)}
                      onValueChange={(v) => setPacketMonitor({ streamMaxPackets: Number(v) })}
                    >
                      <SelectTrigger id="pm-stream-max">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5000">5K packets</SelectItem>
                        <SelectItem value="10000">10K packets</SelectItem>
                        <SelectItem value="25000">25K packets</SelectItem>
                        <SelectItem value="50000">50K packets</SelectItem>
                        <SelectItem value="100000">100K packets</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Max packets in the live streaming view.</p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pm-max-sessions">Max sessions in memory</Label>
                    <Select
                      value={String(pm.maxSessionsInMemory)}
                      onValueChange={(v) => setPacketMonitor({ maxSessionsInMemory: Number(v) })}
                    >
                      <SelectTrigger id="pm-max-sessions">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[3, 5, 10, 15, 20].map((n) => (
                          <SelectItem key={n} value={String(n)}>{n} sessions</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pm-session-timeout">Session timeout</Label>
                    <Select
                      value={String(pm.sessionTimeoutSecs)}
                      onValueChange={(v) => setPacketMonitor({ sessionTimeoutSecs: Number(v) })}
                    >
                      <SelectTrigger id="pm-session-timeout">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="300">5 minutes</SelectItem>
                        <SelectItem value="900">15 minutes</SelectItem>
                        <SelectItem value="1800">30 minutes</SelectItem>
                        <SelectItem value="3600">1 hour</SelectItem>
                        <SelectItem value="7200">2 hours</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Evict stopped sessions after this time.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Polling & Display */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Polling & Display</h3>
              <div className="ui-panel-shell grid gap-4 p-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="pm-packet-poll">Packet poll interval</Label>
                    <Select
                      value={String(pm.packetPollIntervalMs)}
                      onValueChange={(v) => setPacketMonitor({ packetPollIntervalMs: Number(v) })}
                    >
                      <SelectTrigger id="pm-packet-poll">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="100">100ms</SelectItem>
                        <SelectItem value="250">250ms</SelectItem>
                        <SelectItem value="500">500ms</SelectItem>
                        <SelectItem value="1000">1s</SelectItem>
                        <SelectItem value="2000">2s</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pm-stats-poll">Stats poll interval</Label>
                    <Select
                      value={String(pm.statsPollIntervalMs)}
                      onValueChange={(v) => setPacketMonitor({ statsPollIntervalMs: Number(v) })}
                    >
                      <SelectTrigger id="pm-stats-poll">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="500">500ms</SelectItem>
                        <SelectItem value="1000">1s</SelectItem>
                        <SelectItem value="2000">2s</SelectItem>
                        <SelectItem value="5000">5s</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pm-page-size">Fetch page size</Label>
                    <Select
                      value={String(pm.pageSize)}
                      onValueChange={(v) => setPacketMonitor({ pageSize: Number(v) })}
                    >
                      <SelectTrigger id="pm-page-size">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1000">1K</SelectItem>
                        <SelectItem value="2500">2.5K</SelectItem>
                        <SelectItem value="5000">5K</SelectItem>
                        <SelectItem value="10000">10K</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Packets per batch fetch.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pipeline Tuning */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Pipeline Tuning</h3>
                <span className="text-xs text-muted-foreground">Advanced</span>
              </div>
              <div className="ui-panel-shell grid gap-4 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pm-raw-queue">Raw packet queue</Label>
                    <Select
                      value={String(pm.pipelineRawQueueSize)}
                      onValueChange={(v) => setPacketMonitor({ pipelineRawQueueSize: Number(v) })}
                    >
                      <SelectTrigger id="pm-raw-queue">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="16384">16K</SelectItem>
                        <SelectItem value="32768">32K</SelectItem>
                        <SelectItem value="65536">64K</SelectItem>
                        <SelectItem value="131072">128K</SelectItem>
                        <SelectItem value="262144">256K</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pm-parsed-queue">Parsed packet queue</Label>
                    <Select
                      value={String(pm.pipelineParsedQueueSize)}
                      onValueChange={(v) => setPacketMonitor({ pipelineParsedQueueSize: Number(v) })}
                    >
                      <SelectTrigger id="pm-parsed-queue">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="8192">8K</SelectItem>
                        <SelectItem value="16384">16K</SelectItem>
                        <SelectItem value="32768">32K</SelectItem>
                        <SelectItem value="65536">64K</SelectItem>
                        <SelectItem value="131072">128K</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pm-parser-threads">Parser threads</Label>
                    <Select
                      value={String(pm.pipelineParserThreads)}
                      onValueChange={(v) => setPacketMonitor({ pipelineParserThreads: Number(v) })}
                    >
                      <SelectTrigger id="pm-parser-threads">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Auto (CPU cores)</SelectItem>
                        <SelectItem value="1">1 thread</SelectItem>
                        <SelectItem value="2">2 threads</SelectItem>
                        <SelectItem value="4">4 threads</SelectItem>
                        <SelectItem value="8">8 threads</SelectItem>
                        <SelectItem value="16">16 threads</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pm-write-batch">Write batch size</Label>
                    <Select
                      value={String(pm.pipelineWriteBatchSize)}
                      onValueChange={(v) => setPacketMonitor({ pipelineWriteBatchSize: Number(v) })}
                    >
                      <SelectTrigger id="pm-write-batch">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="250">250</SelectItem>
                        <SelectItem value="500">500</SelectItem>
                        <SelectItem value="1000">1,000</SelectItem>
                        <SelectItem value="2500">2,500</SelectItem>
                        <SelectItem value="5000">5,000</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Packets written per PCAP batch.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* RTP Detection */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">RTP Detection</h3>
              <div className="ui-panel-shell p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pm-rtp-low">RTP port range (low)</Label>
                    <Input
                      id="pm-rtp-low"
                      type="number"
                      min="1024"
                      max="65535"
                      value={pm.rtpPortRangeLow}
                      onChange={(e) => setPacketMonitor({ rtpPortRangeLow: Math.max(1024, Math.min(65535, parseInt(e.target.value) || 10000)) })}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pm-rtp-high">RTP port range (high)</Label>
                    <Input
                      id="pm-rtp-high"
                      type="number"
                      min="1024"
                      max="65535"
                      value={pm.rtpPortRangeHigh}
                      onChange={(e) => setPacketMonitor({ rtpPortRangeHigh: Math.max(1024, Math.min(65535, parseInt(e.target.value) || 60000)) })}
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  UDP ports in this range are classified as RTP for stream detection and quality analysis.
                </p>
              </div>
            </div>

            <div className="pt-2">
              <TooltipWrapper entry={tooltips.settingsResetDefaults}>
                <Button variant="neutral" size="sm" onClick={resetPacketMonitor}>
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                  Reset all to defaults
                </Button>
              </TooltipWrapper>
            </div>
          </TabsContent>

          <TabsContent value="fax" className="flex-1 overflow-y-auto mt-0 p-6 space-y-8">
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold">Fax Settings</h2>
              <p className="text-sm text-muted-foreground">
                T.30 / T.38 options for sending and receiving faxes.
              </p>
            </div>

            {/* Shared media allocation */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Media Port Range (Shared)</h3>
              <div className="ui-panel-shell p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
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
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-2">
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
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Shared allocation used by both Fax Center and Soft Phone media sessions.
                </p>
              </div>
            </div>

            {/* Send & Receive Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Send & Receive (T.30)</h3>
                <span className="text-xs text-muted-foreground">Common options</span>
              </div>
              
              <div className="ui-panel-shell grid gap-4 p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="fax-settings-ecm" className="cursor-pointer">ECM (Error Correction Mode)</Label>
                    <p className="text-xs text-muted-foreground">Reduces errors over poor lines</p>
                  </div>
                  <Checkbox
                    id="fax-settings-ecm"
                    checked={faxSafe.ecm}
                    onCheckedChange={(v) => setFax({ ecm: v === true })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="fax-settings-g711-only" className="cursor-pointer">Use G.711 only (no T.38)</Label>
                    <p className="text-xs text-muted-foreground">Send fax over G.711 audio only</p>
                  </div>
                  <Checkbox
                    id="fax-settings-g711-only"
                    checked={faxSafe.useG711Only}
                    onCheckedChange={(v) => setFax({ useG711Only: v === true })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="fax-settings-baud">Baud rate</Label>
                    <Select
                      value={String(faxSafe.baudRate)}
                      onValueChange={(v) => setFax({ baudRate: Number(v) })}
                    >
                      <SelectTrigger id="fax-settings-baud">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FAX_BAUD_RATES.map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {r} baud
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fax-settings-resolution">Resolution</Label>
                    <Select
                      value={faxSafe.resolution}
                      onValueChange={(v) => setFax({ resolution: v as FaxResolution })}
                    >
                      <SelectTrigger id="fax-settings-resolution">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard (204×98 lpi)</SelectItem>
                        <SelectItem value="fine">Fine (204×196 lpi)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            {/* Send Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Send</h3>
              <div className="ui-panel-shell grid gap-4 sm:grid-cols-3 p-4">
                <div className="space-y-2">
                  <Label htmlFor="fax-settings-send-retries">Max retries</Label>
                  <Select
                    value={String(faxSafe.sendRetries)}
                    onValueChange={(v) => setFax({ sendRetries: Number(v) })}
                  >
                    <SelectTrigger id="fax-settings-send-retries">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fax-settings-dis-timeout">DIS timeout</Label>
                  <Select
                    value={String(faxSafe.disTimeoutSecs)}
                    onValueChange={(v) => setFax({ disTimeoutSecs: Number(v) })}
                  >
                    <SelectTrigger id="fax-settings-dis-timeout">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 10, 15, 20, 25, 30].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}s
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fax-settings-mcf-timeout">MCF timeout</Label>
                  <Select
                    value={String(faxSafe.mcfTimeoutSecs)}
                    onValueChange={(v) => setFax({ mcfTimeoutSecs: Number(v) })}
                  >
                    <SelectTrigger id="fax-settings-mcf-timeout">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 10, 15, 20, 25, 30].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}s
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Receive Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Receive</h3>
              <div className="ui-panel-shell grid gap-4 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="fax-settings-receive-timeout">Receive timeout</Label>
                    <Select
                      value={String(faxSafe.receiveTimeoutSecs)}
                      onValueChange={(v) => setFax({ receiveTimeoutSecs: Number(v) })}
                    >
                      <SelectTrigger id="fax-settings-receive-timeout">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[30, 60, 90, 120, 180, 240, 300].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}s
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fax-settings-auto-answer">Auto-answer after</Label>
                    <Select
                      value={String(faxSafe.autoAnswerRings)}
                      onValueChange={(v) => setFax({ autoAnswerRings: Number(v) })}
                    >
                      <SelectTrigger id="fax-settings-auto-answer">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Manual only</SelectItem>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n} ring{n !== 1 ? "s" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fax-settings-save-folder">Save received to folder</Label>
                  <Input
                    id="fax-settings-save-folder"
                    value={faxSafe.saveReceivedToFolder}
                    onChange={(e) => setFax({ saveReceivedToFolder: e.target.value })}
                    placeholder="Leave empty for app only"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional folder path. Empty = store in app only.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <TooltipWrapper entry={tooltips.settingsResetDefaults}>
                <Button variant="neutral" size="sm" onClick={resetFax}>
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                  Reset all to defaults
                </Button>
              </TooltipWrapper>
            </div>
          </TabsContent>

          <TabsContent value="terminal" className="flex-1 overflow-y-auto mt-0 p-6 space-y-8">
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold">Terminal</h2>
              <p className="text-sm text-muted-foreground">
                Appearance and behavior settings for the built-in terminal emulator.
              </p>
            </div>

            {/* Appearance */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Appearance</h3>
              <div className="ui-panel-shell grid gap-4 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="term-font-size">Font size</Label>
                    <Select
                      value={String(terminalSettings.fontSize)}
                      onValueChange={(v) => setTerminal({ fontSize: Number(v) })}
                    >
                      <SelectTrigger id="term-font-size">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 11, 12, 13, 14, 15, 16, 18, 20].map((s) => (
                          <SelectItem key={s} value={String(s)}>{s}px</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="term-line-height">Line height</Label>
                    <Select
                      value={String(terminalSettings.lineHeight)}
                      onValueChange={(v) => setTerminal({ lineHeight: Number(v) })}
                    >
                      <SelectTrigger id="term-line-height">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0].map((h) => (
                          <SelectItem key={h} value={String(h)}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            {/* Cursor */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Cursor</h3>
              <div className="ui-panel-shell divide-y divide-border/30">
                <div className="p-4 space-y-2">
                  <Label htmlFor="term-cursor-style">Cursor style</Label>
                  <Select
                    value={terminalSettings.cursorStyle}
                    onValueChange={(v) => setTerminal({ cursorStyle: v as TerminalCursorStyle })}
                  >
                    <SelectTrigger id="term-cursor-style" className="w-full sm:w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bar">Bar (|)</SelectItem>
                      <SelectItem value="block">Block (█)</SelectItem>
                      <SelectItem value="underline">Underline (_)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="term-cursor-blink" className="cursor-pointer">Blinking cursor</Label>
                    <p className="text-xs text-muted-foreground">Animate the terminal cursor.</p>
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
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Behavior</h3>
              <div className="ui-panel-shell divide-y divide-border/30">
                <div className="p-4 space-y-2">
                  <Label htmlFor="term-scrollback">Scrollback buffer</Label>
                  <Select
                    value={String(terminalSettings.scrollback)}
                    onValueChange={(v) => setTerminal({ scrollback: Number(v) })}
                  >
                    <SelectTrigger id="term-scrollback" className="w-full sm:w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1000">1,000 lines</SelectItem>
                      <SelectItem value="5000">5,000 lines</SelectItem>
                      <SelectItem value="10000">10,000 lines</SelectItem>
                      <SelectItem value="25000">25,000 lines</SelectItem>
                      <SelectItem value="50000">50,000 lines</SelectItem>
                      <SelectItem value="100000">100,000 lines</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Number of lines kept in the scroll history. Higher values use more memory.
                  </p>
                </div>
                <div className="flex items-center justify-between p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="term-confirm-close" className="cursor-pointer">Confirm before closing</Label>
                    <p className="text-xs text-muted-foreground">Show a confirmation dialog when closing the terminal window. All active sessions will be terminated.</p>
                  </div>
                  <Checkbox
                    id="term-confirm-close"
                    checked={terminalSettings.confirmOnClose}
                    onCheckedChange={(v) => setTerminal({ confirmOnClose: v === true })}
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              <TooltipWrapper entry={tooltips.settingsResetDefaults}>
                <Button variant="neutral" size="sm" onClick={resetTerminal}>
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                  Reset all to defaults
                </Button>
              </TooltipWrapper>
            </div>
          </TabsContent>

          <TabsContent value="soft-phone" className="flex-1 overflow-y-auto mt-0">
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <SoftphoneSettingsView />
            </Suspense>
          </TabsContent>

          <TabsContent value="inventory" className="flex-1 overflow-y-auto mt-0 p-6">
            <div className="space-y-1.5 mb-4">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">Tools & Licenses</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Manifest-driven inventory of tool modules and dependency licenses.
              </p>
            </div>
            <div className="ui-panel-shell overflow-hidden">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <AdminInventoryView />
              </Suspense>
            </div>
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

