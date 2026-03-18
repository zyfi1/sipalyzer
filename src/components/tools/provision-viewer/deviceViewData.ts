/**
 * Provision data parser for Yealink device visualization.
 * 
 * Parses configuration parameters according to official Yealink documentation:
 * - linekey.X.type/value/label/line/extension
 * - programablekey.X.type/value/label
 * - softkey.X.enable/label/position
 * - account.X.label/display_name/user_name
 * 
 * Reference: https://support.yealink.com/en/portal/knowledge/show?id=64995b706a27da76bd0719f1
 */

import { useMemo } from "react";
import type { DeviceLayout } from "./deviceLayouts";
import { getSidecarLayout, type SidecarLayout } from "./deviceLayouts";

export interface KeyValue {
  key: string;
  value: string;
}

/** DSS Key type IDs from Yealink documentation */
export const DSS_KEY_TYPES: Record<number, { name: string; shortName: string }> = {
  0: { name: "N/A", shortName: "—" },
  1: { name: "Conference", shortName: "Conf" },
  2: { name: "Forward", shortName: "Fwd" },
  3: { name: "Transfer", shortName: "Xfer" },
  4: { name: "Hold", shortName: "Hold" },
  5: { name: "DND", shortName: "DND" },
  7: { name: "Recall", shortName: "Recall" },
  8: { name: "SMS", shortName: "SMS" },
  9: { name: "Pickup", shortName: "Pickup" },
  10: { name: "Call Park", shortName: "Park" },
  11: { name: "DTMF", shortName: "DTMF" },
  12: { name: "Voice Mail", shortName: "VM" },
  13: { name: "Speed Dial", shortName: "Speed" },
  14: { name: "Intercom", shortName: "Icom" },
  15: { name: "Line", shortName: "Line" },
  16: { name: "BLF", shortName: "BLF" },
  17: { name: "URL", shortName: "URL" },
  18: { name: "Group Listening", shortName: "Listen" },
  20: { name: "Private Hold", shortName: "PvtHold" },
  22: { name: "XML Group", shortName: "XMLGrp" },
  23: { name: "Group Pickup", shortName: "GrpPkup" },
  24: { name: "Paging", shortName: "Page" },
  25: { name: "Record", shortName: "Record" },
  27: { name: "XML Browser", shortName: "XML" },
  28: { name: "History", shortName: "History" },
  30: { name: "Menu", shortName: "Menu" },
  33: { name: "Status", shortName: "Status" },
  34: { name: "Hot Desking", shortName: "HotDesk" },
  35: { name: "URL Record", shortName: "URLRec" },
  38: { name: "LDAP", shortName: "LDAP" },
  39: { name: "BLF List", shortName: "BLFList" },
  40: { name: "Prefix", shortName: "Prefix" },
  41: { name: "Zero Touch", shortName: "Zero" },
  42: { name: "ACD", shortName: "ACD" },
  45: { name: "Local Group", shortName: "LocGrp" },
  50: { name: "Phone Lock", shortName: "Lock" },
  51: { name: "Switch Account Up", shortName: "AccUp" },
  52: { name: "Switch Account Down", shortName: "AccDn" },
  56: { name: "Retrieve Park", shortName: "Retrieve" },
  61: { name: "Directory", shortName: "Dir" },
  66: { name: "Paging List", shortName: "PageList" },
  73: { name: "Custom Key", shortName: "Custom" },
  77: { name: "Mobile Account", shortName: "Mobile" },
  104: { name: "Google Contacts", shortName: "Google" },
  105: { name: "XML Park", shortName: "XMLPark" },
  150: { name: "Extend", shortName: "Extend" },
  310: { name: "DECT Intercom", shortName: "DECT" },
};

/** LED status for line keys */
export type LedStatus = "off" | "green" | "red" | "amber" | "blinking";

/** Parsed line key configuration */
export interface LineKeyConfig {
  index: number;
  type: number;
  typeName: string;
  typeShortName: string;
  line: number;
  value: string;
  label: string;
  extension: string;
  /** Computed display label (uses label if set, else type name) */
  displayLabel: string;
  /** Whether this key is configured (type != 0 or has value) */
  isConfigured: boolean;
  /** LED status based on configuration */
  ledStatus: LedStatus;
  /**
   * Yealink quirk: unassigned sidecar keys (type 0, no value/label) are
   * automatically filled with speed dials from the phone's local contacts
   * directory. This flag marks keys that would display a contact speed dial
   * on the real hardware, even though they're not explicitly provisioned.
   */
  contactSpeedDial?: boolean;
}

/** Parsed programmable key configuration */
export interface ProgrammableKeyConfig {
  index: number;
  type: number;
  typeName: string;
  line: number;
  value: string;
  label: string;
  displayLabel: string;
  isConfigured: boolean;
}

/** Parsed account configuration */
export interface AccountConfig {
  index: number;
  label: string;
  displayName: string;
  userName: string;
  authName: string;
  server: string;
  isRegistered: boolean;
  displayLabel: string;
}

/** Parsed softkey configuration */
export interface SoftkeyConfig {
  index: number;
  position: number;
  label: string;
  enabled: boolean;
  useOnTalk: boolean;
}

/** Complete parsed device data */
export interface DeviceViewData {
  /** All line key configurations (1-indexed, up to totalLineKeys) */
  lineKeys: LineKeyConfig[];
  /** Line keys for current page (based on physicalLineKeys per page) */
  currentPageLineKeys: LineKeyConfig[];
  /** Current page number (1-based) */
  currentPage: number;
  /** Total pages */
  totalPages: number;
  /** Programmable key configurations */
  programmableKeys: ProgrammableKeyConfig[];
  /** Account configurations */
  accounts: AccountConfig[];
  /** Softkey label pages for idle state (each page = array of labels, last is "More") */
  idleSoftkeyPages: string[][];
  /** Softkey label pages for talk/call state (each page = array of labels, last is "More") */
  talkSoftkeyPages: string[][];
  /** Metadata for custom softkeys — maps label → action info for simulation */
  softkeyMeta: Record<string, SoftkeyMeta>;
  /** Network IP address */
  networkIp: string | null;
  /** MAC address */
  macAddress: string | null;
  /** Current time string */
  timeStr: string;
  /** Current date string */
  dateStr: string;
  /** Wallpaper/background URL (if configured) */
  wallpaperUrl: string | null;
  /** Layout info */
  layout: DeviceLayout;
}

function toMap(entries: KeyValue[] | null): Record<string, string> {
  if (!entries?.length) return {};
  return Object.fromEntries(
    entries.map((e) => [e.key.toLowerCase().trim(), (e.value?.trim() ?? "") as string])
  );
}

function isPlaceholder(v: string | null | undefined): boolean {
  if (v == null || v === "") return true;
  return /%null%|%NULL%|undefined|\$\{|\{\{/i.test(String(v));
}

function cleanValue(v: string | null | undefined): string {
  if (v == null) return "";
  const s = String(v).trim();
  return isPlaceholder(s) ? "" : s;
}

function getInt(map: Record<string, string>, key: string, defaultVal: number = 0): number {
  const v = map[key.toLowerCase()];
  if (v == null || v === "") return defaultVal;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? defaultVal : n;
}

function getString(map: Record<string, string>, key: string): string {
  return cleanValue(map[key.toLowerCase()]);
}

/**
 * Determine whether a DSS key is truly configured (functional) on a Yealink phone.
 *
 * Yealink bug / quirk: some provisioning systems set type=13 (Speed Dial) on
 * unused keys with no value, label, or extension.  On the actual phone these
 * display as empty / non-functional.  We mirror that here.
 *
 * Rules:
 * - Type 0 (N/A)  → never configured
 * - "Self-contained" types that work without a value  → always configured
 *     (Line 15, DND 5, Hold 4, Forward 2, Conference 1, Recall 7, Menu 30,
 *      History 28, Status 33, Phone Lock 50, Directory 61, Switch Acct 51/52)
 * - "Value-dependent" types (Speed Dial 13, BLF 16, Intercom 14, DTMF 11,
 *   Paging 24, etc.)  → only configured when at least one of value/label/extension
 *   is populated.
 */
function isKeyConfigured(type: number, value: string, label: string, extension: string): boolean {
  if (type === 0) return value !== "" || label !== "";

  // Types that are functional without a value (toggles, menus, built-in features)
  const SELF_CONTAINED_TYPES = new Set([
    1,  // Conference
    2,  // Forward
    4,  // Hold
    5,  // DND
    7,  // Recall
    15, // Line
    20, // Private Hold
    25, // Record (toggle)
    28, // History
    30, // Menu
    33, // Status
    34, // Hot Desking
    42, // ACD
    50, // Phone Lock
    51, // Switch Account Up
    52, // Switch Account Down
    61, // Directory
    66, // Paging List
  ]);

  if (SELF_CONTAINED_TYPES.has(type)) return true;

  // Everything else (Speed Dial, BLF, Intercom, DTMF, Pickup, Paging,
  // Park, Voice Mail, URL, XML Browser, LDAP, BLF List, etc.)
  // requires at least a value, label, or extension to be meaningful
  return value !== "" || label !== "" || extension !== "";
}

function parseLineKeys(map: Record<string, string>, totalKeys: number): LineKeyConfig[] {
  const keys: LineKeyConfig[] = [];
  
  for (let i = 1; i <= totalKeys; i++) {
    // Try both line_key.X and linekey.X formats
    const type = getInt(map, `linekey.${i}.type`) || getInt(map, `line_key.${i}.type`);
    const line = getInt(map, `linekey.${i}.line`, 1) || getInt(map, `line_key.${i}.line`, 1);
    const value = getString(map, `linekey.${i}.value`) || getString(map, `line_key.${i}.value`);
    const label = getString(map, `linekey.${i}.label`) || getString(map, `line_key.${i}.label`);
    const extension = getString(map, `linekey.${i}.extension`) || getString(map, `line_key.${i}.extension`);
    
    const typeInfo = DSS_KEY_TYPES[type] ?? { name: `Type ${type}`, shortName: `T${type}` };
    const isConfigured = isKeyConfigured(type, value, label, extension);
    
    // Determine display label
    let displayLabel = label;
    if (!displayLabel) {
      if (type === 15) {
        // Line type - show account info or "Line X"
        displayLabel = `Line ${line}`;
      } else if (type === 16 && value) {
        // BLF - show the extension being monitored
        displayLabel = value;
      } else if (type === 13 && value) {
        // Speed dial - show the number
        displayLabel = value;
      } else if (type === 14 && value) {
        // Intercom - show target
        displayLabel = value;
      } else if (type === 24 && value) {
        // Paging - show multicast address or label
        displayLabel = value.length > 12 ? "Paging" : value;
      } else if (type === 12 && value) {
        // Voice Mail - show number
        displayLabel = value;
      } else if (isConfigured) {
        displayLabel = typeInfo.shortName;
      } else {
        displayLabel = "—";
      }
    }
    
    // Determine LED status
    let ledStatus: LedStatus = "off";
    if (isConfigured) {
      if (type === 15) {
        // Line key - green if registered (we assume registered for display)
        ledStatus = "green";
      } else if (type === 16) {
        // BLF - shows monitored extension status; green = available (default for display)
        ledStatus = "green";
      }
    }
    
    keys.push({
      index: i,
      type,
      typeName: typeInfo.name,
      typeShortName: typeInfo.shortName,
      line,
      value,
      label,
      extension,
      displayLabel,
      isConfigured,
      ledStatus,
    });
  }
  
  return keys;
}

function parseProgrammableKeys(map: Record<string, string>, count: number): ProgrammableKeyConfig[] {
  const keys: ProgrammableKeyConfig[] = [];
  
  // Programmable key indices vary by model, check common ones
  const indices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18];
  
  for (const i of indices.slice(0, count)) {
    const type = getInt(map, `programablekey.${i}.type`) || getInt(map, `programmablekey.${i}.type`);
    const line = getInt(map, `programablekey.${i}.line`, 1);
    const value = getString(map, `programablekey.${i}.value`) || getString(map, `programmablekey.${i}.value`);
    const label = getString(map, `programablekey.${i}.label`) || getString(map, `programmablekey.${i}.label`);
    
    const typeInfo = DSS_KEY_TYPES[type] ?? { name: `Type ${type}`, shortName: `T${type}` };
    const isConfigured = isKeyConfigured(type, value, label, "");
    const displayLabel = label || (isConfigured ? typeInfo.shortName : "—");
    
    keys.push({
      index: i,
      type,
      typeName: typeInfo.name,
      line,
      value,
      label,
      displayLabel,
      isConfigured,
    });
  }
  
  return keys;
}

function parseAccounts(map: Record<string, string>, maxAccounts: number): AccountConfig[] {
  const accounts: AccountConfig[] = [];
  
  for (let i = 1; i <= maxAccounts; i++) {
    const label = getString(map, `account.${i}.label`);
    const displayName = getString(map, `account.${i}.display_name`);
    const userName = getString(map, `account.${i}.user_name`);
    const authName = getString(map, `account.${i}.auth_name`);
    const server = getString(map, `account.${i}.sip_server.1.address`) || 
                   getString(map, `account.${i}.sip_server_host`);
    const enable = getInt(map, `account.${i}.enable`, 0);
    
    const isRegistered = enable === 1 && (userName !== "" || authName !== "");
    const displayLabel = label || displayName || userName || authName || `Account ${i}`;
    
    accounts.push({
      index: i,
      label,
      displayName,
      userName,
      authName,
      server,
      isRegistered,
      displayLabel,
    });
  }
  
  return accounts;
}

/**
 * Metadata about a custom softkey: its action macro, id, and detected behavior type.
 * Yealink EDK action strings use patterns like:
 *   #3$P1N4$$Tdtmf$  → blind transfer with prompted input + DTMF
 *   #1$Cuser$         → speed dial / call
 *   #3$Cuser$         → blind transfer to a fixed number
 *   #4$Cuser$         → attended transfer to a fixed number
 */
export interface SoftkeyMeta {
  label: string;
  action: string;
  softkeyId: string;
  /** Detected behavior type for simulation */
  behavior: "transfer" | "speed_dial" | "dtmf" | "hold" | "conference" | "unknown";
  /** Whether the action prompts for user input (contains $P) */
  promptsInput: boolean;
  /** Fixed value embedded in the action (e.g., $Cext$) */
  fixedValue: string | null;
}

/** Detect behavior type from a Yealink EDK action string */
function detectSoftkeyBehavior(action: string, softkeyId: string): Pick<SoftkeyMeta, "behavior" | "promptsInput" | "fixedValue"> {
  const a = action.trim();
  const id = softkeyId.toLowerCase();

  // Detect if action prompts for input ($P = prompt)
  const promptsInput = /\$P/i.test(a);

  // Extract fixed value from $C...$ pattern (call/value)
  const fixedMatch = a.match(/\$C([^$]*)\$/i);
  const fixedValue = fixedMatch?.[1] || null;

  // Detect behavior from action prefix and patterns
  // #3 = blind transfer, #4 = attended transfer
  if (/^#[34]/.test(a) || id.includes("xfer") || id.includes("transfer")) {
    return { behavior: "transfer", promptsInput, fixedValue };
  }
  // #5 = conference
  if (/^#5/.test(a) || id.includes("conf")) {
    return { behavior: "conference", promptsInput, fixedValue };
  }
  // #2 = hold
  if (/^#2/.test(a) || id === "hold") {
    return { behavior: "hold", promptsInput, fixedValue };
  }
  // #1 = call/speed dial
  if (/^#1/.test(a) || id.includes("speed") || id.includes("dial")) {
    return { behavior: "speed_dial", promptsInput, fixedValue };
  }
  // DTMF patterns (Tdtmf or just dtmf in action)
  if (/dtmf/i.test(a) || /\$T/i.test(a)) {
    return { behavior: "dtmf", promptsInput, fixedValue };
  }

  return { behavior: "unknown", promptsInput, fixedValue };
}

/** Parse softkey metadata from provision data */
function parseSoftkeyMeta(map: Record<string, string>): Record<string, SoftkeyMeta> {
  const meta: Record<string, SoftkeyMeta> = {};
  for (let n = 1; n <= 24; n++) {
    const enable = getString(map, `softkey.${n}.enable`);
    if (enable !== "1") continue;

    const label = getString(map, `softkey.${n}.label`);
    if (!label) continue;

    const action = getString(map, `softkey.${n}.action`);
    const softkeyId = getString(map, `softkey.${n}.softkey_id`);

    if (!action && !softkeyId) continue;

    const detected = detectSoftkeyBehavior(action, softkeyId);
    const nextMeta: SoftkeyMeta = {
      label,
      action,
      softkeyId,
      ...detected,
    };
    const existing = meta[label];
    if (!existing || (!existing.action && !!nextMeta.action)) {
      meta[label] = nextMeta;
    }
  }
  return meta;
}

/**
 * Parse softkeys into pages that cycle with the "More" button.
 * Real Yealink phones show `softkeyCount` buttons at a time, with the last being "More"
 * to cycle to the next page. This gives `softkeyCount - 1` usable slots per page.
 */
function parseSoftkeyPages(map: Record<string, string>, softkeyCount: number, onTalk: boolean): string[][] {
  const usablePerPage = softkeyCount - 1; // Last slot reserved for "More" on multi-page only
  if (usablePerPage < 1) return [["More"]];

  // Default softkey labels — matches real Yealink idle/talk defaults
  const defaultIdleLabels = ["History", "Dir", "DND", "Menu", "Status", "CallFwd"];
  const defaultTalkLabels = ["Hold", "Xfer", "Conf", "EndCall", "NewCall", "ReDial"];
  const defaults = onTalk ? defaultTalkLabels : defaultIdleLabels;

  // Build a position → label map (1-based)
  const keyMap: Record<number, string> = {};
  for (let i = 0; i < defaults.length; i++) {
    keyMap[i + 1] = defaults[i]!;
  }

  // Override with configured softkeys from provision
  for (let n = 1; n <= 24; n++) {
    const enable = getString(map, `softkey.${n}.enable`);
    const useOnTalk = getString(map, `softkey.${n}.use.on_talk`);

    if (enable !== "1") continue;
    if ((useOnTalk === "1") !== onTalk) continue;

    const label = getString(map, `softkey.${n}.label`);
    const posStr = getString(map, `softkey.${n}.position`);
    const pos = posStr === "" ? n : parseInt(posStr, 10);

    if (pos >= 1 && label) {
      keyMap[pos] = label;
    }
  }

  // Determine how many pages we need
  const maxPos = Object.keys(keyMap).length > 0
    ? Math.max(...Object.keys(keyMap).map(Number))
    : usablePerPage;
  const totalPages = Math.max(1, Math.ceil(maxPos / usablePerPage));

  // Build pages
  const pages: string[][] = [];
  for (let p = 0; p < totalPages; p++) {
    const page: string[] = [];
    const slotsOnPage = totalPages > 1 ? usablePerPage : softkeyCount;
    for (let s = 0; s < slotsOnPage; s++) {
      const pos = p * usablePerPage + s + 1;
      page.push(keyMap[pos] || "—");
    }
    if (totalPages > 1) {
      page.push("More");
    }
    pages.push(page);
  }

  // If a page (other than the first) is entirely empty placeholders + More, trim it
  while (pages.length > 1) {
    const last = pages[pages.length - 1]!;
    if (last.slice(0, -1).every(l => l === "—")) {
      pages.pop();
    } else {
      break;
    }
  }

  return pages;
}

export function useDeviceViewData(
  parsedEntries: KeyValue[] | null,
  layout: DeviceLayout,
  _inCall: boolean = false,
  page: number = 1
): DeviceViewData {
  const map = useMemo(() => toMap(parsedEntries), [parsedEntries]);
  
  const lineKeys = useMemo(
    () => parseLineKeys(map, layout.totalLineKeys),
    [map, layout.totalLineKeys]
  );
  
  const totalPages = layout.lineKeyPages || 1;
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const keysPerPage = layout.physicalLineKeys;
  
  const currentPageLineKeys = useMemo(() => {
    if (keysPerPage === 0) return [];
    const startIdx = (currentPage - 1) * keysPerPage;
    return lineKeys.slice(startIdx, startIdx + keysPerPage);
  }, [lineKeys, currentPage, keysPerPage]);
  
  const programmableKeys = useMemo(
    () => parseProgrammableKeys(map, layout.programmableKeys),
    [map, layout.programmableKeys]
  );
  
  const accounts = useMemo(
    () => parseAccounts(map, Math.max(1, Math.min(16, layout.totalLineKeys || 16))),
    [map, layout.totalLineKeys]
  );
  
  const idleSoftkeyPages = useMemo(
    () => parseSoftkeyPages(map, layout.softkeyCount, false),
    [map, layout.softkeyCount]
  );

  const talkSoftkeyPages = useMemo(
    () => parseSoftkeyPages(map, layout.softkeyCount, true),
    [map, layout.softkeyCount]
  );

  const softkeyMeta = useMemo(
    () => parseSoftkeyMeta(map),
    [map]
  );
  
  const networkIp = useMemo(() => {
    const v = getString(map, "network.ip_address") ||
              getString(map, "network.lan.ip_address") ||
              getString(map, "network.eth.0.ip_address");
    return v || null;
  }, [map]);
  
  const macAddress = useMemo(() => {
    const v = getString(map, "mac") ||
              getString(map, "network.mac") ||
              getString(map, "features.mac");
    return v || null;
  }, [map]);
  
  // Wallpaper / background URL
  const wallpaperUrl = useMemo(() => {
    const isUrl = (v: string) => /^https?:\/\//i.test(v);
    // Check common Yealink wallpaper keys — only accept actual HTTP(S) URLs
    const candidates = [
      "wallpaper_upload.url",
      "phone_setting.backgrounds",
      "phone_setting.wallpaper_url",
      "phone_setting.background_image",
      "phone_setting.backgrounds.url",
      "wallpaper.url",
      "screensaver.url",
      "phone_setting.screensaver.url",
    ];
    for (const key of candidates) {
      const v = getString(map, key);
      if (v && isUrl(v)) return v;
    }
    // Fallback: scan all keys for any wallpaper/background/screensaver key with a URL value
    for (const [k, v] of Object.entries(map)) {
      if (/wallpaper|background|screensaver/i.test(k) && v && isUrl(v)) {
        return v;
      }
    }
    return null;
  }, [map]);

  // Respect provision time settings
  const timeFormat = getInt(map, "local_time.time_format", -1);
  const dateFormat = getInt(map, "phone_setting.date_format", -1);
  const tzOffsetRaw = getString(map, "local_time.time_zone");
  const tzName = getString(map, "local_time.time_zone_name");
  
  // Parse timezone offset to get the correct current time
  const now = new Date();
  let displayDate = now;
  
  if (tzName) {
    // Try IANA timezone name first (e.g. "America/New_York")
    try {
      const formatted = now.toLocaleString("en-US", { timeZone: tzName });
      displayDate = new Date(formatted);
    } catch {
      // If IANA name fails, fall through to offset parsing
    }
  }
  
  if (displayDate === now && tzOffsetRaw) {
    // Parse offset string: "+8", "-5", "+01:00", "-05:30", "+0530"
    const match = tzOffsetRaw.match(/^([+-]?)(\d{1,2})(?::?(\d{2}))?$/);
    if (match) {
      const sign = match[1] === "-" ? -1 : 1;
      const hours = parseInt(match[2]!, 10);
      const minutes = parseInt(match[3] || "0", 10);
      const offsetMinutes = sign * (hours * 60 + minutes);
      // Convert: UTC time = now + local offset, then apply provision offset
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      displayDate = new Date(utcMs + offsetMinutes * 60000);
    }
  }
  
  // Format time based on time_format setting (0 = 12h, 1 = 24h, default = 24h)
  const use12h = timeFormat === 0;
  const timeStr = displayDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: use12h,
  });
  
  // Format date based on date_format setting
  const weekday = displayDate.toLocaleDateString("en-US", { weekday: "short" });
  const month = displayDate.toLocaleDateString("en-US", { month: "short" });
  const day = displayDate.getDate();
  const year = displayDate.getFullYear();
  let dateStr: string;
  switch (dateFormat) {
    case 0: // MM/DD/YYYY
      dateStr = `${weekday}, ${month} ${day} ${year}`;
      break;
    case 1: // DD/MM/YYYY
      dateStr = `${weekday}, ${day} ${month} ${year}`;
      break;
    case 2: // YYYY/MM/DD
      dateStr = `${weekday}, ${year} ${month} ${day}`;
      break;
    default: // No setting — use sensible default
      dateStr = `${weekday}, ${month} ${day}`;
      break;
  }
  
  return {
    lineKeys,
    currentPageLineKeys,
    currentPage,
    totalPages,
    programmableKeys,
    accounts,
    idleSoftkeyPages,
    talkSoftkeyPages,
    softkeyMeta,
    networkIp,
    macAddress,
    timeStr,
    dateStr,
    wallpaperUrl,
    layout,
  };
}

// ── Sidecar / Expansion Module ──────────────────────────────────────────────

/** Parsed sidecar unit with its keys */
export interface SidecarUnit {
  /** Unit number (1-based, e.g. 1 = first sidecar) */
  unitIndex: number;
  /** Layout for this sidecar model */
  layout: SidecarLayout;
  /** All keys for this unit */
  keys: LineKeyConfig[];
  /** Number of configured (non-empty) keys */
  configuredCount: number;
}

/** Complete sidecar data for a phone */
export interface SidecarData {
  /** Compatible sidecar layout (null if phone doesn't support sidecars) */
  sidecarLayout: SidecarLayout | null;
  /** Detected sidecar units (only units with at least one configured key) */
  units: SidecarUnit[];
  /** Whether sidecar keys were auto-detected in the provision config */
  autoDetected: boolean;
  /** Total configured keys across all sidecar units */
  totalConfiguredKeys: number;
}

/**
 * Read a single expansion-module key from the provision map.
 *
 * Yealink uses TWO different parameter formats for expansion keys depending
 * on the provisioning source:
 *
 * **1. Native Yealink format (official):**
 *     `expansion_module.M.key.N.type/value/label/line`
 *     Where M = module number (1-6), N = key within that module (1-60).
 *
 * **2. Unified linekey overflow (used by some PBX systems like Yeastar, 3CX):**
 *     `linekey.X.type/value/label/line`
 *     Where X > totalLineKeys (i.e., keys beyond the phone's native line keys
 *     are mapped to the expansion module sequentially).
 *
 * We try the native `expansion_module` format FIRST, then fall back to
 * `linekey` overflow if nothing is found.
 *
 * **Yealink quirk:** Unassigned sidecar keys (type 0, no value/label/extension)
 * are automatically populated with speed dials from the phone's local contacts.
 */
function readExpKey(
  map: Record<string, string>,
  moduleIdx: number,
  keyIdx: number,
  linekeyOverflowIdx: number,
): { type: number; line: number; value: string; label: string; extension: string } {
  // Try native expansion_module.M.key.N format first.
  // Check if ANY expansion_module param exists for this key (even type=0 counts
  // as "this format is used") by checking for the raw key in the map.
  const emPrefix = `expansion_module.${moduleIdx}.key.${keyIdx}`;
  const emTypeKey = `${emPrefix}.type`.toLowerCase();
  const hasExpansionModule = emTypeKey in map
    || `${emPrefix}.value`.toLowerCase() in map
    || `${emPrefix}.label`.toLowerCase() in map;

  if (hasExpansionModule) {
    return {
      type: getInt(map, `${emPrefix}.type`),
      line: getInt(map, `${emPrefix}.line`, 1),
      value: getString(map, `${emPrefix}.value`),
      label: getString(map, `${emPrefix}.label`),
      extension: getString(map, `${emPrefix}.extension`),
    };
  }

  // Fallback: unified linekey.X overflow (used by Yeastar, 3CX, FusionPBX)
  const type = getInt(map, `linekey.${linekeyOverflowIdx}.type`)
    || getInt(map, `line_key.${linekeyOverflowIdx}.type`);
  const line = getInt(map, `linekey.${linekeyOverflowIdx}.line`, 1)
    || getInt(map, `line_key.${linekeyOverflowIdx}.line`, 1);
  const value = getString(map, `linekey.${linekeyOverflowIdx}.value`)
    || getString(map, `line_key.${linekeyOverflowIdx}.value`);
  const label = getString(map, `linekey.${linekeyOverflowIdx}.label`)
    || getString(map, `line_key.${linekeyOverflowIdx}.label`);
  const extension = getString(map, `linekey.${linekeyOverflowIdx}.extension`)
    || getString(map, `line_key.${linekeyOverflowIdx}.extension`);

  return { type, line, value, label, extension };
}

function parseSidecarKeys(
  map: Record<string, string>,
  phoneLineKeys: number,
  sidecarLayout: SidecarLayout,
): SidecarUnit[] {
  const keysPerUnit = sidecarLayout.totalKeys;
  const maxUnits = sidecarLayout.maxUnits;
  const units: SidecarUnit[] = [];
  const hasLocalContacts = Object.keys(map).some((k) => k.startsWith("local_contact."));

  for (let unit = 0; unit < maxUnits; unit++) {
    const moduleIdx = unit + 1; // expansion_module is 1-based
    const linekeyStart = phoneLineKeys + 1 + unit * keysPerUnit;
    const keys: LineKeyConfig[] = [];
    let configuredCount = 0;
    let contactCount = 0;

    for (let k = 0; k < keysPerUnit; k++) {
      const keyIdx = k + 1; // key within module is 1-based
      const linekeyOverflowIdx = linekeyStart + k;
      const globalIdx = linekeyOverflowIdx; // for display/index purposes

      const { type, line, value, label, extension } = readExpKey(map, moduleIdx, keyIdx, linekeyOverflowIdx);

      const typeInfo = DSS_KEY_TYPES[type] ?? { name: `Type ${type}`, shortName: `T${type}` };
      const isConfigured = isKeyConfigured(type, value, label, extension);

      // Yealink fills unassigned sidecar keys with contact speed dials
      const isUnassigned = type === 0 && value === "" && label === "" && extension === "";
      const contactSpeedDial = isUnassigned && hasLocalContacts;

      let displayLabel = label;
      if (!displayLabel) {
        if (contactSpeedDial) displayLabel = "Contact";
        else if (type === 15) displayLabel = `Line ${line}`;
        else if (type === 16 && value) displayLabel = value;
        else if (type === 13 && value) displayLabel = value;
        else if (type === 14 && value) displayLabel = value;
        else if (type === 24 && value) displayLabel = value.length > 12 ? "Paging" : value;
        else if (type === 12 && value) displayLabel = value;
        else if (isConfigured) displayLabel = typeInfo.shortName;
        else displayLabel = "—";
      }

      let ledStatus: LedStatus = "off";
      if (isConfigured) {
        // Line keys and BLF keys show a green LED when configured
        if (type === 15 || type === 16) ledStatus = "green";
      }

      if (isConfigured) configuredCount++;
      if (contactSpeedDial) contactCount++;

      keys.push({
        index: globalIdx,
        type,
        typeName: contactSpeedDial ? "Contact Speed Dial" : typeInfo.name,
        typeShortName: contactSpeedDial ? "Contact" : typeInfo.shortName,
        line,
        value,
        label,
        extension,
        displayLabel,
        isConfigured,
        ledStatus,
        contactSpeedDial,
      });
    }

    const shouldIncludeUnit = configuredCount > 0 || contactCount > 0;
    if (shouldIncludeUnit) {
      units.push({
        unitIndex: moduleIdx,
        layout: sidecarLayout,
        keys,
        configuredCount,
      });
    } else if (units.length > 0) {
      break;
    }
  }

  return units;
}

/**
 * Detect whether the provision data contains expansion module key configuration.
 *
 * Checks TWO sources:
 * 1. Native `expansion_module.X.key.Y.*` parameters
 * 2. Overflow `linekey.X.*` where X > phone's totalLineKeys
 */
function detectExpansionKeys(map: Record<string, string>, phoneLineKeys: number): boolean {
  const hasLocalContacts = Object.keys(map).some((k) => k.startsWith("local_contact."));
  let hasAnyExpansionNamespaceKey = false;
  for (const k of Object.keys(map)) {
    // Check native expansion_module format
    if (/^expansion_module\.\d+\.key\.\d+\./i.test(k)) {
      hasAnyExpansionNamespaceKey = true;
      const v = cleanValue(map[k]);
      if (/\.type$/i.test(k) && v !== "" && v !== "0") return true;
      if (/\.(value|label|extension)$/i.test(k) && v !== "") return true;
      continue;
    }
    // Check linekey overflow
    const m = k.match(/^linekey\.(\d+)\./i) || k.match(/^line_key\.(\d+)\./i);
    if (m && parseInt(m[1]!, 10) > phoneLineKeys) {
      const v = cleanValue(map[k]);
      if (/\.type$/i.test(k) && v !== "" && v !== "0") return true;
      if (/\.(value|label|extension)$/i.test(k) && v !== "") return true;
    }
  }
  if (hasLocalContacts && hasAnyExpansionNamespaceKey) return true;
  return false;
}

/**
 * Hook that parses sidecar data from provision entries for a given phone model.
 */
export function useSidecarData(
  parsedEntries: KeyValue[] | null,
  modelId: string,
  phoneLayout: DeviceLayout,
): SidecarData {
  const map = useMemo(() => toMap(parsedEntries), [parsedEntries]);
  const sidecarLayout = useMemo(() => getSidecarLayout(modelId), [modelId]);

  return useMemo(() => {
    if (!sidecarLayout) {
      return { sidecarLayout: null, units: [], autoDetected: false, totalConfiguredKeys: 0 };
    }

    const phoneLineKeys = phoneLayout.totalLineKeys;

    // Detect presence of expansion keys from EITHER format:
    //   1. expansion_module.M.key.N.* (native Yealink)
    //   2. linekey.X.* where X > phoneLineKeys (PBX unified numbering)
    const autoDetected = detectExpansionKeys(map, phoneLineKeys);

    // Always parse — returns at least 1 unit for compatible models
    const units = parseSidecarKeys(map, phoneLineKeys, sidecarLayout);
    const totalConfiguredKeys = units.reduce((sum, u) => sum + u.configuredCount, 0);

    return { sidecarLayout, units, autoDetected, totalConfiguredKeys };
  }, [map, sidecarLayout, phoneLayout.totalLineKeys]);
}

// Re-export types that were previously exported
export type { AccountConfig as AccountRow };
export type { LineKeyConfig as LineKeyRow };
