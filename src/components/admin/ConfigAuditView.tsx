import { useState, useMemo, useRef } from "react";
import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import { useSettingsStore } from "@/stores/settingsStore";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { exportFullAppBackup, restoreFullAppBackupFromText, auditBackupRestoreFailure } from "@/lib/appBackup";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  RotateCcw,
  Loader2,
} from "@/lib/icons";

interface SettingRow {
  key: string;
  current: unknown;
  default_: unknown;
  modified: boolean;
}

interface SettingSection {
  name: string;
  resetKey?: string;
  rows: SettingRow[];
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "function") continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(result, flattenObject(v as Record<string, unknown>, key));
    } else {
      result[key] = v;
    }
  }
  return result;
}

export function ConfigAuditView() {
  const store = useSettingsStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["General"]));
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  const sections = useMemo((): SettingSection[] => {
    const currentFlat = flattenObject(store as unknown as Record<string, unknown>);

    const groups: SettingSection[] = [
      {
        name: "User Agent",
        resetKey: "userAgent",
        rows: buildRows(currentFlat, "userAgent", {
          "userAgent.preset": "default",
          "userAgent.customValue": "",
        }),
      },
      {
        name: "Fax",
        resetKey: "fax",
        rows: buildRows(currentFlat, "fax", {
          "fax.ecm": true,
          "fax.useG711Only": false,
          "fax.baudRate": 14400,
          "fax.resolution": "standard",
          "fax.sendRetries": 3,
          "fax.receiveTimeoutSecs": 120,
          "fax.disTimeoutSecs": 15,
          "fax.mcfTimeoutSecs": 10,
          "fax.autoAnswerRings": 0,
          "fax.saveReceivedToFolder": "",
          "fax.stationId": "",
        }),
      },
      {
        name: "Packet Monitor",
        resetKey: "packetMonitor",
        rows: buildRows(currentFlat, "packetMonitor", {
          "packetMonitor.pipelineMode": true,
          "packetMonitor.autoScroll": true,
          "packetMonitor.ringBufferCapacity": 2_000_000,
          "packetMonitor.maxSessionsInMemory": 10,
          "packetMonitor.sessionTimeoutSecs": 1800,
          "packetMonitor.packetPollIntervalMs": 500,
          "packetMonitor.statsPollIntervalMs": 1000,
          "packetMonitor.pageSize": 5000,
          "packetMonitor.streamMaxPackets": 10_000,
          "packetMonitor.pipelineRawQueueSize": 65_536,
          "packetMonitor.pipelineParsedQueueSize": 32_768,
          "packetMonitor.pipelineParserThreads": 0,
          "packetMonitor.pipelineWriteBatchSize": 1000,
          "packetMonitor.rtpPortRangeLow": 10_000,
          "packetMonitor.rtpPortRangeHigh": 60_000,
        }),
      },
      {
        name: "Terminal",
        resetKey: "terminal",
        rows: buildRows(currentFlat, "terminal", {
          "terminal.fontSize": 13,
          "terminal.lineHeight": 1.4,
          "terminal.cursorStyle": "bar",
          "terminal.cursorBlink": true,
          "terminal.scrollback": 10000,
          "terminal.confirmOnClose": true,
        }),
      },
      {
        name: "Media Ports",
        resetKey: "mediaPorts",
        rows: buildRows(currentFlat, "mediaPorts", {
          "mediaPorts.rangeLow": 10_000,
          "mediaPorts.rangeHigh": 65_500,
        }),
      },
      {
        name: "General",
        resetKey: "general",
        rows: buildRows(currentFlat, "", {
          timezone: "",
          timeFormat: "24h",
          dateFormat: "system",
          temperatureUnit: "celsius",
          weatherLocation: "",
          weatherLat: null,
          weatherLon: null,
          confirmOnClose: false,
          minimizeToTray: false,
          hideDockIcon: false,
          showTrayIcon: true,
        }),
      },
    ];
    return groups;
  }, [store]);
  const modifiedTotal = useMemo(
    () => sections.reduce((sum, section) => sum + section.rows.filter((r) => r.modified).length, 0),
    [sections],
  );

  const toggleSection = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleReset = () => {
    if (!resetTarget) return;
    const s = useSettingsStore.getState();
    if (resetTarget === "userAgent") s.resetUserAgent();
    else if (resetTarget === "fax") s.resetFax();
    else if (resetTarget === "packetMonitor") s.resetPacketMonitor();
    else if (resetTarget === "terminal") s.resetTerminal();
    else if (resetTarget === "mediaPorts") s.resetMediaPorts();
    else if (resetTarget === "general") {
      s.setTimezone("");
      s.setTimeFormat("24h");
      s.setDateFormat("system");
      s.setTemperatureUnit("celsius");
      s.setWeatherLocation("");
      s.setWeatherCoords(null, null);
      s.setConfirmOnClose(false);
      s.setMinimizeToTray(false);
      s.setHideDockIcon(false);
      s.setShowTrayIcon(true);
    }
    setResetTarget(null);
  };

  const handleExport = () => {
    const state = useSettingsStore.getState();
    const exportable = {
      userAgent: state.userAgent,
      fax: state.fax,
      packetMonitor: state.packetMonitor,
      terminal: state.terminal,
      mediaPorts: state.mediaPorts,
      timezone: state.timezone,
      timeFormat: state.timeFormat,
      dateFormat: state.dateFormat,
      temperatureUnit: state.temperatureUnit,
      weatherLocation: state.weatherLocation,
      weatherLat: state.weatherLat,
      weatherLon: state.weatherLon,
      confirmOnClose: state.confirmOnClose,
      minimizeToTray: state.minimizeToTray,
      hideDockIcon: state.hideDockIcon,
      showTrayIcon: state.showTrayIcon,
    };
    const json = JSON.stringify(exportable, null, 2);
    saveExportFile(`sipalyzer-settings-${new Date().toISOString().slice(0, 10)}.json`, textToBase64(json), "JSON files", "json").catch(() => {});
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const s = useSettingsStore.getState();
        if (parsed.userAgent && typeof parsed.userAgent === "object") {
          useSettingsStore.setState({ userAgent: parsed.userAgent });
          s.syncUserAgentToBackend();
        }
        if (parsed.fax) s.setFax(parsed.fax);
        if (parsed.packetMonitor) s.setPacketMonitor(parsed.packetMonitor);
        if (parsed.terminal) s.setTerminal(parsed.terminal);
        if (parsed.mediaPorts) s.setMediaPorts(parsed.mediaPorts);
        if (parsed.timezone !== undefined) s.setTimezone(parsed.timezone);
        if (parsed.timeFormat) s.setTimeFormat(parsed.timeFormat);
        if (parsed.dateFormat) s.setDateFormat(parsed.dateFormat);
        if (parsed.temperatureUnit) s.setTemperatureUnit(parsed.temperatureUnit);
        if (parsed.weatherLocation !== undefined) s.setWeatherLocation(parsed.weatherLocation);
        if (parsed.weatherLat !== undefined || parsed.weatherLon !== undefined) {
          s.setWeatherCoords(parsed.weatherLat ?? null, parsed.weatherLon ?? null);
        }
        if (parsed.confirmOnClose !== undefined) s.setConfirmOnClose(!!parsed.confirmOnClose);
        if (parsed.showTrayIcon !== undefined) s.setShowTrayIcon(!!parsed.showTrayIcon);
        if (parsed.minimizeToTray !== undefined) s.setMinimizeToTray(!!parsed.minimizeToTray);
        if (parsed.hideDockIcon !== undefined) s.setHideDockIcon(!!parsed.hideDockIcon);
      } catch {
        // silent
      }
    };
    input.click();
  };

  const handleExportFullBackup = async () => {
    setBackupBusy(true);
    try {
      await exportFullAppBackup("admin-settings-audit");
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreFullBackup = async (file: File | null) => {
    if (!file) return;
    setRestoreBusy(true);
    try {
      const text = await file.text();
      await restoreFullAppBackupFromText(text, "admin-settings-audit", file.name);
    } catch (err) {
      await auditBackupRestoreFailure(
        "admin-settings-audit",
        err instanceof Error ? err.message : String(err),
        file.name,
      );
    } finally {
      setRestoreBusy(false);
      if (backupFileInputRef.current) backupFileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto">
      <div className="rounded-lg border border-border/50 bg-card p-3">
        <p className="text-sm font-medium">Settings Audit Coverage</p>
        <p className="text-xs text-muted-foreground mt-1">
          Auditing {sections.length} sections with {modifiedTotal} modified values across current app configuration.
        </p>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2">
        <input
          ref={backupFileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void handleRestoreFullBackup(e.target.files?.[0] ?? null)}
        />
        <Button variant="neutral" size="sm" onClick={handleExport} className="text-xs">
          <Download className="h-3.5 w-3.5 mr-1" />
          Export Settings
        </Button>
        <Button variant="neutral" size="sm" onClick={handleImport} className="text-xs">
          <Upload className="h-3.5 w-3.5 mr-1" />
          Import Settings
        </Button>
        <Button
          variant="neutral"
          size="sm"
          className="text-xs"
          disabled={backupBusy || restoreBusy}
          onClick={() => void handleExportFullBackup()}
        >
          {backupBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
          Full Backup
        </Button>
        <Button
          variant="neutral"
          size="sm"
          className="text-xs"
          disabled={backupBusy || restoreBusy}
          onClick={() => backupFileInputRef.current?.click()}
        >
          {restoreBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
          Full Restore
        </Button>
      </div>

      {/* Sections */}
      {sections.map((section) => {
        const isOpen = expanded.has(section.name);
        const modCount = section.rows.filter((r) => r.modified).length;

        return (
          <div key={section.name} className="rounded-lg bg-card shadow-card overflow-hidden">
            <button
              onClick={() => toggleSection(section.name)}
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-accent/30 transition-smooth"
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="section-title flex-1 text-left">{section.name}</span>
              {modCount > 0 && (
                <span className="rounded-full px-2 py-0.5 text-2xs font-semibold bg-amber-500/12 text-amber-400">
                  {modCount} modified
                </span>
              )}
              {section.resetKey && (
                <Button
                  variant="neutral"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResetTarget(section.resetKey!);
                  }}
                  className="h-6 text-2xs px-2"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              )}
            </button>
            {isOpen && (
              <div className="divide-y divide-border/30">
                {section.rows.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <span className="text-body text-xs">{friendlyName(row.key)}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-body font-mono text-xs max-w-[200px] truncate">
                        {formatValue(row.current)}
                      </span>
                      {row.modified && (
                        <span className="text-muted-foreground font-mono text-2xs max-w-[180px] truncate">
                          default: {formatValue(row.default_)}
                        </span>
                      )}
                      {row.modified && (
                        <span className="rounded-full px-2 py-0.5 text-2xs font-semibold bg-amber-500/12 text-amber-400">
                          Modified
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title={`Reset ${resetTarget} to defaults`}
        description="This will reset all settings in this section to their default values."
        confirmText="Reset"
        variant="destructive"
        onConfirm={handleReset}
      />
    </div>
  );
}

const FRIENDLY_NAMES: Record<string, string> = {
  preset: "Preset",
  customValue: "Custom Value",
  ecm: "Error Correction Mode",
  useG711Only: "G.711 Only",
  baudRate: "Baud Rate",
  resolution: "Resolution",
  sendRetries: "Send Retries",
  receiveTimeoutSecs: "Receive Timeout (sec)",
  disTimeoutSecs: "DIS Timeout (sec)",
  mcfTimeoutSecs: "MCF Timeout (sec)",
  autoAnswerRings: "Auto-Answer Rings",
  saveReceivedToFolder: "Save Received To",
  stationId: "Station ID",
  pipelineMode: "Pipeline Mode",
  autoScroll: "Auto-Scroll",
  ringBufferCapacity: "Ring Buffer Capacity",
  maxSessionsInMemory: "Max Sessions in Memory",
  sessionTimeoutSecs: "Session Timeout (sec)",
  packetPollIntervalMs: "Packet Poll Interval (ms)",
  statsPollIntervalMs: "Stats Poll Interval (ms)",
  pageSize: "Page Size",
  streamMaxPackets: "Stream Max Packets",
  pipelineRawQueueSize: "Pipeline Raw Queue Size",
  pipelineParsedQueueSize: "Pipeline Parsed Queue Size",
  pipelineParserThreads: "Pipeline Parser Threads",
  pipelineWriteBatchSize: "Pipeline Write Batch Size",
  rtpPortRangeLow: "RTP Port Range (Low)",
  rtpPortRangeHigh: "RTP Port Range (High)",
  fontSize: "Font Size",
  fontFamily: "Font Family",
  lineHeight: "Line Height",
  cursorStyle: "Cursor Style",
  cursorBlink: "Cursor Blink",
  scrollback: "Scrollback Lines",
  confirmOnClose: "Confirm on Close",
  timezone: "Timezone",
  timeFormat: "Time Format",
  dateFormat: "Date Format",
  temperatureUnit: "Temperature Unit",
  weatherLocation: "Weather Location",
  weatherLat: "Weather Latitude",
  weatherLon: "Weather Longitude",
  minimizeToTray: "Minimize to Tray",
  hideDockIcon: "Hide Dock Icon",
  showTrayIcon: "Show Tray Icon",
  rangeLow: "Port Range (Low)",
  rangeHigh: "Port Range (High)",
};

function friendlyName(key: string): string {
  return FRIENDLY_NAMES[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

function buildRows(
  currentFlat: Record<string, unknown>,
  prefix: string,
  defaults: Record<string, unknown>,
): SettingRow[] {
  return Object.entries(defaults).map(([key, defaultVal]) => {
    const current = currentFlat[key];
    const shortKey = key.replace(`${prefix}.`, "");
    return {
      key: shortKey,
      current,
      default_: defaultVal,
      modified: JSON.stringify(current) !== JSON.stringify(defaultVal),
    };
  });
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v || "(empty)";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}
