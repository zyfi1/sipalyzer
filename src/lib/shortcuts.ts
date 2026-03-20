/**
 * Central keyboard shortcut definitions.
 * Registered once in App; Escape closes topmost overlay.
 */

export const SHORTCUTS = {
  // ── Global ───────────────────────────────────────────────────────────────
  search: "ctrl+k",
  shortcutsPanel: "ctrl+/",
  shortcutsPanelAlt: "shift+?", // ? with shift
  escape: "escape",

  // ── Top-level tool navigation ────────────────────────────────────────────
  goHome: "ctrl+1",
  goPacketCapture: "ctrl+2",
  goRegistration: "ctrl+3",
  goSoftPhone: "ctrl+4",
  goFaxCenter: "ctrl+5",
  goProvisionViewer: "ctrl+6",
  goNetworkTest: "ctrl+7",

  // ── Panels ───────────────────────────────────────────────────────────────
  openNotes: "ctrl+shift+n",
  openNotifications: "ctrl+shift+m",
  openSettings: "ctrl+,",
  toggleSidebar: "ctrl+b",

  // ── Utilities ────────────────────────────────────────────────────────────
  clearAllViews: "ctrl+shift+k",
  refreshUi: "ctrl+shift+r",

  // ── Dedicated per-view shortcuts (tool subviews) ────────────────────────
  viewPacketMonitor: "ctrl+shift+q",
  viewPacketCaptures: "ctrl+shift+w",
  viewPacketViewer: "ctrl+shift+e",
  viewPacketAnalysis: "ctrl+shift+a",
  viewPacketDiff: "ctrl+shift+z",
  viewPacketRemote: "ctrl+shift+s",
  viewPacketScheduled: "ctrl+shift+d",

  viewSoftPhone: "ctrl+shift+t",
  viewSoftContacts: "ctrl+shift+g",
  viewSoftRecordings: "ctrl+shift+y",

  viewFaxSend: "ctrl+shift+u",
  viewFaxHistory: "ctrl+shift+i",

  viewProvisionMain: "ctrl+shift+j",
  viewProvisionContacts: "ctrl+shift+l",
  viewProvisionDevice: "ctrl+shift+o",
  viewProvisionDiff: "ctrl+shift+p",
  viewProvisionDesigner: "ctrl+shift+h",

  viewNetworkConnectivity: "ctrl+shift+f",
  viewNetworkProbe: "ctrl+shift+x",
  viewNetworkDevices: "ctrl+shift+v",
  viewNetworkVoip: "ctrl+shift+c",
  viewNetworkMulticast: "ctrl+shift+b",

  viewRemoteOverview: "ctrl+alt+o",
  viewRemoteRegistry: "ctrl+alt+r",
  viewRemoteActivity: "ctrl+alt+a",

  viewComposerRequests: "ctrl+alt+q",
  viewComposerSsh: "ctrl+alt+s",
  viewComposerHistory: "ctrl+alt+h",
  viewComposerDocs: "ctrl+alt+d",

  viewToolsSyslog: "ctrl+alt+y",
  viewToolsLogs: "ctrl+alt+l",
  viewToolsFileServer: "ctrl+alt+f",
  viewToolsFirmware: "ctrl+alt+w",
  viewToolsPasswordGen: "ctrl+alt+p",
  viewToolsMcp: "ctrl+alt+m",
} as const;

export type ShortcutKey = keyof typeof SHORTCUTS;

/** Build shortcut string from keyboard event (lowercase, no spaces). */
export function shortcutFromEvent(e: KeyboardEvent): string {
  const key = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;
  const parts: string[] = [];
  if (ctrl) parts.push("ctrl");
  if (shift) parts.push("shift");
  if (alt) parts.push("alt");
  parts.push(key);
  return parts.join("+");
}

/** Human-readable label for a shortcut (e.g. "⌘K"). */
export function shortcutLabel(shortcut: string): string {
  return shortcut
    .split("+")
    .map((p) => {
      if (p === "ctrl") return "⌘";
      if (p === "shift") return "⇧";
      if (p === "alt") return "⌥";
      if (p === "escape") return "Esc";
      return p.toUpperCase();
    })
    .join("");
}
