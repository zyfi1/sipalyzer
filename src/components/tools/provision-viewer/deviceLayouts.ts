/**
 * Yealink device physical layouts — accurate specs from official datasheets.
 * 
 * Data sourced from:
 * - Yealink Support: https://support.yealink.com/en/portal/knowledge/show?id=64995b706a27da76bd0719f1
 * - Official datasheets for each model
 * 
 * Key distinctions:
 * - physicalLineKeys: buttons physically visible on one page (with LEDs)
 * - totalLineKeys: all configurable line keys (across pages)
 * - programmableKeys: physical feature keys that can be reprogrammed
 * - lineKeyPosition: where physical line keys are located relative to screen
 */

export type LineKeyPosition = "right" | "left" | "both" | "touchscreen";

export interface DeviceLayout {
  id: string;
  name: string;
  /** Screen resolution in pixels (width x height) */
  screenWidth: number;
  screenHeight: number;
  /** Physical line key buttons visible on one page (with LEDs) */
  physicalLineKeys: number;
  /** Total configurable line keys (across all pages) */
  totalLineKeys: number;
  /** Number of pages for line keys */
  lineKeyPages: number;
  /** Position of physical line keys relative to screen */
  lineKeyPosition: LineKeyPosition;
  /** Keys per side (for "both" position) or per column */
  keysPerSide: number;
  /** Number of softkeys (context-sensitive below screen) */
  softkeyCount: number;
  /** Total programmable keys (hard keys that can be reprogrammed) */
  programmableKeys: number;
  /** Whether device has a touchscreen */
  touchscreen?: boolean;
  /** Screen type: color or grayscale */
  screenType: "color" | "grayscale";
}

/**
 * Complete Yealink device specifications based on official documentation.
 */
const LAYOUTS: DeviceLayout[] = [
  // ===== T5 Series (Premium) =====
  {
    id: "T57W",
    name: "SIP-T57W",
    screenWidth: 800,
    screenHeight: 480,
    physicalLineKeys: 0, // Touchscreen only
    totalLineKeys: 29,
    lineKeyPages: 1,
    lineKeyPosition: "touchscreen",
    keysPerSide: 0,
    softkeyCount: 4,
    programmableKeys: 29,
    touchscreen: true,
    screenType: "color",
  },
  {
    id: "T54W",
    name: "SIP-T54W",
    screenWidth: 480,
    screenHeight: 272,
    physicalLineKeys: 10, // 5 per side
    totalLineKeys: 27,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 5,
    softkeyCount: 4,
    programmableKeys: 15,
    screenType: "color",
  },
  {
    id: "T53W",
    name: "SIP-T53W",
    screenWidth: 360,
    screenHeight: 160,
    physicalLineKeys: 8, // 4 per side
    totalLineKeys: 21,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 4,
    softkeyCount: 4,
    programmableKeys: 13,
    screenType: "color",
  },
  {
    id: "T53",
    name: "SIP-T53",
    screenWidth: 360,
    screenHeight: 160,
    physicalLineKeys: 8,
    totalLineKeys: 21,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 4,
    softkeyCount: 4,
    programmableKeys: 13,
    screenType: "color",
  },
  {
    id: "T53C",
    name: "SIP-T53C",
    screenWidth: 360,
    screenHeight: 160,
    physicalLineKeys: 8,
    totalLineKeys: 21,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 4,
    softkeyCount: 4,
    programmableKeys: 13,
    screenType: "color",
  },

  // ===== T4 Series (Business) =====
  {
    id: "T48U",
    name: "SIP-T48U",
    screenWidth: 800,
    screenHeight: 480,
    physicalLineKeys: 0,
    totalLineKeys: 29,
    lineKeyPages: 1,
    lineKeyPosition: "touchscreen",
    keysPerSide: 0,
    softkeyCount: 4,
    programmableKeys: 29,
    touchscreen: true,
    screenType: "color",
  },
  {
    id: "T48S",
    name: "SIP-T48S",
    screenWidth: 800,
    screenHeight: 480,
    physicalLineKeys: 0,
    totalLineKeys: 29,
    lineKeyPages: 1,
    lineKeyPosition: "touchscreen",
    keysPerSide: 0,
    softkeyCount: 4,
    programmableKeys: 29,
    touchscreen: true,
    screenType: "color",
  },
  {
    id: "T48G",
    name: "SIP-T48G",
    screenWidth: 800,
    screenHeight: 480,
    physicalLineKeys: 0,
    totalLineKeys: 29,
    lineKeyPages: 1,
    lineKeyPosition: "touchscreen",
    keysPerSide: 0,
    softkeyCount: 4,
    programmableKeys: 29,
    touchscreen: true,
    screenType: "color",
  },
  {
    id: "T46U",
    name: "SIP-T46U",
    screenWidth: 480,
    screenHeight: 272,
    physicalLineKeys: 10, // 5 per side
    totalLineKeys: 27,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 5,
    softkeyCount: 4,
    programmableKeys: 15,
    screenType: "color",
  },
  {
    id: "T46S",
    name: "SIP-T46S",
    screenWidth: 480,
    screenHeight: 272,
    physicalLineKeys: 10,
    totalLineKeys: 27,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 5,
    softkeyCount: 4,
    programmableKeys: 15,
    screenType: "color",
  },
  {
    id: "T46G",
    name: "SIP-T46G",
    screenWidth: 480,
    screenHeight: 272,
    physicalLineKeys: 10, // 5 left, 5 right with LEDs
    totalLineKeys: 27,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 5,
    softkeyCount: 4,
    programmableKeys: 15,
    screenType: "color",
  },
  {
    id: "T43U",
    name: "SIP-T43U",
    screenWidth: 360,
    screenHeight: 160,
    physicalLineKeys: 8,
    totalLineKeys: 21,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 4,
    softkeyCount: 4,
    programmableKeys: 21,
    screenType: "color",
  },
  {
    id: "T42U",
    name: "SIP-T42U",
    screenWidth: 192,
    screenHeight: 64,
    physicalLineKeys: 6, // 3 per side
    totalLineKeys: 15,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 3,
    softkeyCount: 4,
    programmableKeys: 15,
    screenType: "grayscale",
  },
  {
    id: "T42S",
    name: "SIP-T42S",
    screenWidth: 192,
    screenHeight: 64,
    physicalLineKeys: 6,
    totalLineKeys: 15,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 3,
    softkeyCount: 4,
    programmableKeys: 15,
    screenType: "grayscale",
  },
  {
    id: "T42G",
    name: "SIP-T42G",
    screenWidth: 192,
    screenHeight: 64,
    physicalLineKeys: 6,
    totalLineKeys: 15,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 3,
    softkeyCount: 4,
    programmableKeys: 15,
    screenType: "grayscale",
  },
  {
    id: "T41S",
    name: "SIP-T41S",
    screenWidth: 192,
    screenHeight: 64,
    physicalLineKeys: 6,
    totalLineKeys: 15,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 3,
    softkeyCount: 4,
    programmableKeys: 15,
    screenType: "grayscale",
  },
  {
    id: "T41P",
    name: "SIP-T41P",
    screenWidth: 192,
    screenHeight: 64,
    physicalLineKeys: 6,
    totalLineKeys: 6,
    lineKeyPages: 1,
    lineKeyPosition: "both",
    keysPerSide: 3,
    softkeyCount: 4,
    programmableKeys: 6,
    screenType: "grayscale",
  },
  {
    id: "T40P",
    name: "SIP-T40P",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 3,
    totalLineKeys: 3,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 3,
    softkeyCount: 4,
    programmableKeys: 3,
    screenType: "grayscale",
  },
  {
    id: "T40G",
    name: "SIP-T40G",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 3,
    totalLineKeys: 3,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 3,
    softkeyCount: 4,
    programmableKeys: 3,
    screenType: "grayscale",
  },

  // ===== T3 Series (Entry) - Keys on RIGHT side =====
  {
    id: "T34W",
    name: "SIP-T34W",
    screenWidth: 320,
    screenHeight: 240,
    physicalLineKeys: 4, // All on right side
    totalLineKeys: 12,
    lineKeyPages: 3,
    lineKeyPosition: "right",
    keysPerSide: 4,
    softkeyCount: 4,
    programmableKeys: 13,
    screenType: "color",
  },
  {
    id: "T33G",
    name: "SIP-T33G",
    screenWidth: 320,
    screenHeight: 240,
    physicalLineKeys: 4, // 4 physical keys on RIGHT with LEDs
    totalLineKeys: 12, // 3 pages of 4 = 12 configurable
    lineKeyPages: 3,
    lineKeyPosition: "right",
    keysPerSide: 4,
    softkeyCount: 4,
    programmableKeys: 12,
    screenType: "color",
  },
  {
    id: "T33P",
    name: "SIP-T33P",
    screenWidth: 320,
    screenHeight: 240,
    physicalLineKeys: 4,
    totalLineKeys: 12,
    lineKeyPages: 3,
    lineKeyPosition: "right",
    keysPerSide: 4,
    softkeyCount: 4,
    programmableKeys: 12,
    screenType: "color",
  },
  {
    id: "T31W",
    name: "SIP-T31W",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 2,
    totalLineKeys: 2,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 2,
    softkeyCount: 4,
    programmableKeys: 2,
    screenType: "grayscale",
  },
  {
    id: "T31G",
    name: "SIP-T31G",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 2,
    totalLineKeys: 2,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 2,
    softkeyCount: 4,
    programmableKeys: 2,
    screenType: "grayscale",
  },
  {
    id: "T31P",
    name: "SIP-T31P",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 2,
    totalLineKeys: 2,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 2,
    softkeyCount: 4,
    programmableKeys: 2,
    screenType: "grayscale",
  },
  {
    id: "T31",
    name: "SIP-T31",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 2,
    totalLineKeys: 2,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 2,
    softkeyCount: 4,
    programmableKeys: 2,
    screenType: "grayscale",
  },
  {
    id: "T30P",
    name: "SIP-T30P",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 0, // No physical line keys
    totalLineKeys: 0,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 0,
    softkeyCount: 4,
    programmableKeys: 0,
    screenType: "grayscale",
  },
  {
    id: "T30",
    name: "SIP-T30",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 0,
    totalLineKeys: 0,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 0,
    softkeyCount: 4,
    programmableKeys: 0,
    screenType: "grayscale",
  },

  // ===== T2 Series (Legacy) =====
  {
    id: "T29G",
    name: "SIP-T29G",
    screenWidth: 480,
    screenHeight: 272,
    physicalLineKeys: 10, // 5 per side
    totalLineKeys: 27,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 5,
    softkeyCount: 4,
    programmableKeys: 16,
    screenType: "color",
  },
  {
    id: "T27G",
    name: "SIP-T27G",
    screenWidth: 240,
    screenHeight: 120,
    physicalLineKeys: 8, // 4 per side
    totalLineKeys: 21,
    lineKeyPages: 3,
    lineKeyPosition: "both",
    keysPerSide: 4,
    softkeyCount: 4,
    programmableKeys: 16,
    screenType: "grayscale",
  },
  {
    id: "T23P",
    name: "SIP-T23P",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 3,
    totalLineKeys: 3,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 3,
    softkeyCount: 3,
    programmableKeys: 3,
    screenType: "grayscale",
  },
  {
    id: "T23G",
    name: "SIP-T23G",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 3,
    totalLineKeys: 3,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 3,
    softkeyCount: 3,
    programmableKeys: 3,
    screenType: "grayscale",
  },
  {
    id: "T21P",
    name: "SIP-T21P",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 2,
    totalLineKeys: 2,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 2,
    softkeyCount: 2,
    programmableKeys: 2,
    screenType: "grayscale",
  },
  {
    id: "T19P",
    name: "SIP-T19P",
    screenWidth: 132,
    screenHeight: 64,
    physicalLineKeys: 1,
    totalLineKeys: 1,
    lineKeyPages: 1,
    lineKeyPosition: "right",
    keysPerSide: 1,
    softkeyCount: 2,
    programmableKeys: 1,
    screenType: "grayscale",
  },

  // ===== Conference Phones =====
  {
    id: "CP965",
    name: "SIP-CP965",
    screenWidth: 480,
    screenHeight: 480,
    physicalLineKeys: 0,
    totalLineKeys: 30,
    lineKeyPages: 1,
    lineKeyPosition: "touchscreen",
    keysPerSide: 0,
    softkeyCount: 4,
    programmableKeys: 4,
    touchscreen: true,
    screenType: "color",
  },
  {
    id: "CP960",
    name: "SIP-CP960",
    screenWidth: 480,
    screenHeight: 480,
    physicalLineKeys: 0,
    totalLineKeys: 30,
    lineKeyPages: 1,
    lineKeyPosition: "touchscreen",
    keysPerSide: 0,
    softkeyCount: 3,
    programmableKeys: 3,
    touchscreen: true,
    screenType: "color",
  },
  {
    id: "CP925",
    name: "SIP-CP925",
    screenWidth: 480,
    screenHeight: 800,
    physicalLineKeys: 0,
    totalLineKeys: 0,
    lineKeyPages: 1,
    lineKeyPosition: "touchscreen",
    keysPerSide: 0,
    softkeyCount: 4,
    programmableKeys: 0,
    touchscreen: true,
    screenType: "color",
  },
  {
    id: "CP920",
    name: "SIP-CP920",
    screenWidth: 248,
    screenHeight: 120,
    physicalLineKeys: 0,
    totalLineKeys: 0,
    lineKeyPages: 1,
    lineKeyPosition: "touchscreen",
    keysPerSide: 0,
    softkeyCount: 4,
    programmableKeys: 0,
    screenType: "grayscale",
  },

  // ===== Video Phones =====
  {
    id: "VP59",
    name: "SIP-VP59",
    screenWidth: 1280,
    screenHeight: 800,
    physicalLineKeys: 0,
    totalLineKeys: 16,
    lineKeyPages: 1,
    lineKeyPosition: "touchscreen",
    keysPerSide: 0,
    softkeyCount: 4,
    programmableKeys: 16,
    touchscreen: true,
    screenType: "color",
  },
];

// ── Yealink model catalog used by DeviceModelPicker (single source) ────────

export const YEALINK_PICKER_SERIES: Array<{ key: string; label: string; ids: string[] }> = [
  { key: "t5", label: "T5x Series — Premium / Mid-range", ids: ["T57W", "T54W", "T53W", "T53"] },
  { key: "t4us", label: "T4x Series — U/S Models", ids: ["T48U", "T48S", "T46U", "T46S", "T43U", "T42U", "T42S", "T41S"] },
  { key: "t4g", label: "T4x Series — G/P Models", ids: ["T48G", "T46G", "T42G", "T41P", "T40P", "T40G"] },
  { key: "t3", label: "T3x Series — Entry", ids: ["T34W", "T33G", "T33P", "T31W", "T31G", "T31P", "T31", "T30P", "T30"] },
  { key: "t2", label: "T2x Series — Legacy", ids: ["T29G", "T27G", "T23P", "T21P", "T19P"] },
  { key: "cp", label: "CP Series — Conference", ids: ["CP925", "CP920"] },
  { key: "vp", label: "VP Series — Video", ids: ["VP59"] },
];

const MODEL_TIER: Record<string, string> = {
  T57W: "Premium", T54W: "Premium", T53W: "Premium", T53: "Mid-range",
  T48U: "Business", T48S: "Business", T46U: "Business", T46S: "Business", T43U: "Business", T42U: "Business", T42S: "Business", T41S: "Business",
  T48G: "Business", T46G: "Business", T42G: "Business", T41P: "Business", T40P: "Standard", T40G: "Standard",
  T34W: "Entry", T33G: "Entry", T33P: "Entry", T31W: "Entry", T31G: "Entry", T31P: "Entry", T31: "Entry", T30P: "Entry", T30: "Entry",
  T29G: "Executive", T27G: "Business", T23P: "Entry", T21P: "Entry", T19P: "Basic",
  CP925: "Conference", CP920: "Conference", VP59: "Video",
};

const MODEL_SEARCH: Record<string, string> = {
  T57W: "touchscreen wifi flagship executive", T54W: "wifi color executive", T53W: "wifi color", T53: "color midrange",
  T48U: "touchscreen usb large", T48S: "touchscreen large", T46U: "usb color", T46S: "color", T43U: "usb color", T42U: "usb grayscale", T42S: "grayscale", T41S: "grayscale",
  T48G: "touchscreen gigabit large", T46G: "gigabit color", T42G: "gigabit grayscale", T41P: "poe grayscale", T40P: "poe grayscale basic", T40G: "gigabit grayscale basic",
  T34W: "wifi color entry", T33G: "gigabit color entry", T33P: "poe color entry", T31W: "wifi grayscale entry", T31G: "gigabit grayscale entry", T31P: "poe grayscale entry", T31: "basic grayscale entry", T30P: "poe grayscale entry", T30: "basic grayscale entry",
  T29G: "gigabit color executive", T27G: "gigabit grayscale", T23P: "poe grayscale entry", T21P: "poe grayscale entry", T19P: "poe grayscale basic single",
  CP925: "conference phone speaker touchscreen", CP920: "conference phone speaker grayscale", VP59: "video phone camera touchscreen large",
};

const MODEL_SCREEN_LABEL_OVERRIDE: Record<string, string> = {
  CP925: "4\" 480×800 color touch",
  CP920: "3.1\" 248×120 grayscale",
  VP59: "8\" 1280×800 color touch",
};

const MODEL_KEYS_LABEL_OVERRIDE: Record<string, string> = {
  T57W: "29 touch line keys", T48U: "29 touch line keys", T48S: "29 touch line keys", T48G: "29 touch line keys",
  T54W: "10 line keys (5+5)", T46U: "10 line keys (5+5)", T46S: "10 line keys (5+5)", T46G: "10 line keys (5+5)", T29G: "10 line keys (5+5)",
  T53W: "8 line keys (4+4)", T53: "8 line keys (4+4)", T43U: "8 line keys (4+4)", T27G: "8 line keys (4+4)",
  T42U: "6 line keys (3+3)", T42S: "6 line keys (3+3)", T42G: "6 line keys (3+3)", T41S: "6 line keys (3+3)",
  T41P: "6 line keys", T40P: "3 line keys", T40G: "3 line keys", T34W: "4 line keys", T33G: "4 line keys", T33P: "4 line keys",
  T31W: "2 line keys", T31G: "2 line keys", T31P: "2 line keys", T31: "2 line keys",
  T30P: "No line keys", T30: "No line keys",
  T23P: "3 line keys", T21P: "2 line keys", T19P: "1 line key",
  CP925: "Touch", CP920: "Touch-sensitive keypad", VP59: "Touch line keys",
};

const PICKER_MODEL_IDS = new Set(YEALINK_PICKER_SERIES.flatMap((s) => s.ids));

export const YEALINK_PICKER_META: Record<string, { screen: string; keys: string; tier: string; search: string }> =
  Object.fromEntries(
    LAYOUTS
      .filter((l) => PICKER_MODEL_IDS.has(l.id))
      .map((l) => {
      const screen = MODEL_SCREEN_LABEL_OVERRIDE[l.id] ?? `${l.screenWidth}×${l.screenHeight} ${l.screenType}${l.touchscreen ? " touch" : ""}`;
      const keys = MODEL_KEYS_LABEL_OVERRIDE[l.id] ?? `${l.totalLineKeys} line keys`;
      return [l.id, { screen, keys, tier: MODEL_TIER[l.id] ?? "Business", search: MODEL_SEARCH[l.id] ?? "" }];
    }),
  );

// ── Expansion Module (Sidecar) Layouts ─────────────────────────────────────

export interface SidecarLayout {
  id: string;
  name: string;
  /** Physical keys per page */
  keysPerPage: number;
  /** Number of pages */
  pages: number;
  /** Total keys per unit */
  totalKeys: number;
  /** Maximum number of units that can be daisy-chained */
  maxUnits: number;
  /** Screen type */
  screenType: "color" | "grayscale";
  /** Has LCD labels per key */
  hasLcd: boolean;
}

/**
 * Yealink expansion module specs (from official documentation).
 *
 * EXP20: 20 keys × 2 pages = 40 per unit (grayscale LCD, legacy). For T29G, T27G.
 * EXP40: 20 keys × 2 pages = 40 per unit, up to 6 units (240 total). For T46G/S, T48G/S.
 * EXP43: 20 keys × 3 pages = 60 per unit, up to 3 units (180 total). For T43U, T46U, T48U.
 * EXP50: 20 keys × 3 pages = 60 per unit, up to 3 units (180 total). For T53/T53W/T53C/T54W/T57W.
 */
const SIDECAR_LAYOUTS: SidecarLayout[] = [
  {
    id: "EXP20",
    name: "Yealink EXP20",
    keysPerPage: 20,
    pages: 2,
    totalKeys: 40,
    maxUnits: 6,
    screenType: "grayscale",
    hasLcd: true,
  },
  {
    id: "EXP40",
    name: "Yealink EXP40",
    keysPerPage: 20,
    pages: 2,
    totalKeys: 40,
    maxUnits: 6,
    screenType: "grayscale",
    hasLcd: true,
  },
  {
    id: "EXP43",
    name: "Yealink EXP43",
    keysPerPage: 20,
    pages: 3,
    totalKeys: 60,
    maxUnits: 3,
    screenType: "color",
    hasLcd: true,
  },
  {
    id: "EXP50",
    name: "Yealink EXP50",
    keysPerPage: 20,
    pages: 3,
    totalKeys: 60,
    maxUnits: 3,
    screenType: "color",
    hasLcd: true,
  },
];

/**
 * Maps phone model → compatible expansion module ID.
 * Only models that support an expansion module are listed.
 *
 * Source: https://support.yealink.com/document-detail/0fc92a57703048dda9f0cbe5ee6aa539
 */
const MODEL_TO_SIDECAR: Record<string, string> = {
  // EXP20 — Legacy T2x series (40 ext keys)
  T29G: "EXP20",
  T27G: "EXP20",
  // EXP40 — T4 S/G series (40 ext keys, up to 6 units)
  T46G: "EXP40",
  T46S: "EXP40",
  T48G: "EXP40",
  T48S: "EXP40",
  // EXP43 — T4 U series (60 ext keys, up to 3 units)
  T43U: "EXP43",
  T46U: "EXP43",
  T48U: "EXP43",
  // EXP50 — T5 series (60 ext keys, up to 3 units)
  T53:  "EXP50",
  T53W: "EXP50",
  T53C: "EXP50",
  T54W: "EXP50",
  T57W: "EXP50",
};

const SIDECAR_MAP = new Map(SIDECAR_LAYOUTS.map((s) => [s.id, s]));

/**
 * Get the compatible sidecar layout for a phone model. Returns null if no sidecar supported.
 */
export function getSidecarLayout(modelId: string): SidecarLayout | null {
  const upper = modelId.toUpperCase();
  const sidecarId = MODEL_TO_SIDECAR[upper];
  if (!sidecarId) {
    // Try case-insensitive
    for (const [key, val] of Object.entries(MODEL_TO_SIDECAR)) {
      if (key.toUpperCase() === upper) return SIDECAR_MAP.get(val) ?? null;
    }
    return null;
  }
  return SIDECAR_MAP.get(sidecarId) ?? null;
}

/**
 * Check if a phone model supports expansion modules.
 */
export function modelSupportsSidecar(modelId: string): boolean {
  return getSidecarLayout(modelId) !== null;
}

const LAYOUT_MAP = new Map(LAYOUTS.map((l) => [l.id, l]));

export function getDeviceLayout(modelId: string): DeviceLayout {
  // Try exact match first
  if (LAYOUT_MAP.has(modelId)) return LAYOUT_MAP.get(modelId)!;
  
  // Try case-insensitive match
  const upper = modelId.toUpperCase();
  for (const [key, layout] of LAYOUT_MAP) {
    if (key.toUpperCase() === upper) return layout;
  }
  
  // Default to T46G as a common mid-range model
  return LAYOUT_MAP.get("T46G")!;
}

export function getAllLayoutIds(): string[] {
  return LAYOUTS.map((l) => l.id);
}

export function getAllLayouts(): DeviceLayout[] {
  return [...LAYOUTS];
}
