import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SHORTCUTS, shortcutLabel } from "@/lib/shortcuts";
import { Keyboard, X } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { FEATURE_FLAG_MCP_UI } from "@/lib/featureFlags";
import { isFeatureFlagEnabled } from "@/lib/featureFlagCache";

interface ShortcutsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  heading: string;
  items: { label: string; keys: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    heading: "General",
    items: [
      { label: "Command palette", keys: SHORTCUTS.search },
      { label: "Keyboard shortcuts", keys: SHORTCUTS.shortcutsPanel },
      { label: "Close overlay", keys: SHORTCUTS.escape },
      { label: "Clear every view", keys: SHORTCUTS.clearAllViews },
      { label: "Refresh UI", keys: SHORTCUTS.refreshUi },
    ],
  },
  {
    heading: "Top-Level Tools",
    items: [
      { label: "Go to Home", keys: SHORTCUTS.goHome },
      { label: "Go to Packet Capture", keys: SHORTCUTS.goPacketCapture },
      { label: "Go to Registration", keys: SHORTCUTS.goRegistration },
      { label: "Go to Soft Phone", keys: SHORTCUTS.goSoftPhone },
      { label: "Go to Fax Center", keys: SHORTCUTS.goFaxCenter },
      { label: "Go to Provision Viewer", keys: SHORTCUTS.goProvisionViewer },
      { label: "Go to Network Test", keys: SHORTCUTS.goNetworkTest },
    ],
  },
  {
    heading: "Panels",
    items: [
      { label: "Open Notes", keys: SHORTCUTS.openNotes },
      { label: "Open Notifications", keys: SHORTCUTS.openNotifications },
      { label: "Open Settings", keys: SHORTCUTS.openSettings },
      { label: "Toggle Sidebar", keys: SHORTCUTS.toggleSidebar },
    ],
  },
  {
    heading: "Packet Capture Views",
    items: [
      { label: "Monitor", keys: SHORTCUTS.viewPacketMonitor },
      { label: "Captures", keys: SHORTCUTS.viewPacketCaptures },
      { label: "Viewer", keys: SHORTCUTS.viewPacketViewer },
      { label: "Analysis", keys: SHORTCUTS.viewPacketAnalysis },
      { label: "Remote SSH", keys: SHORTCUTS.viewPacketRemote },
      { label: "Scheduled", keys: SHORTCUTS.viewPacketScheduled },
    ],
  },
  {
    heading: "Soft Phone Views",
    items: [
      { label: "Phone", keys: SHORTCUTS.viewSoftPhone },
      { label: "Contacts", keys: SHORTCUTS.viewSoftContacts },
      { label: "Recordings", keys: SHORTCUTS.viewSoftRecordings },
    ],
  },
  {
    heading: "Fax Center Views",
    items: [
      { label: "Send", keys: SHORTCUTS.viewFaxSend },
      { label: "Faxes", keys: SHORTCUTS.viewFaxHistory },
    ],
  },
  {
    heading: "Provision Viewer Views",
    items: [
      { label: "Provision", keys: SHORTCUTS.viewProvisionMain },
      { label: "Contacts", keys: SHORTCUTS.viewProvisionContacts },
      { label: "Device", keys: SHORTCUTS.viewProvisionDevice },
      { label: "Diff", keys: SHORTCUTS.viewProvisionDiff },
      { label: "Designer", keys: SHORTCUTS.viewProvisionDesigner },
    ],
  },
  {
    heading: "Network Views",
    items: [
      { label: "Routing", keys: SHORTCUTS.viewNetworkConnectivity },
      { label: "Connectivity (VoIP)", keys: SHORTCUTS.viewNetworkVoip },
      { label: "Connectivity (DNS)", keys: SHORTCUTS.viewNetworkProbe },
      { label: "Multicast", keys: SHORTCUTS.viewNetworkMulticast },
      { label: "Devices", keys: SHORTCUTS.viewNetworkDevices },
    ],
  },
  {
    heading: "Remote Agent Views",
    items: [
      { label: "Overview", keys: SHORTCUTS.viewRemoteOverview },
      { label: "Registry", keys: SHORTCUTS.viewRemoteRegistry },
      { label: "Activity", keys: SHORTCUTS.viewRemoteActivity },
    ],
  },
  {
    heading: "Composer Views",
    items: [
      { label: "Requests", keys: SHORTCUTS.viewComposerRequests },
      { label: "SSH", keys: SHORTCUTS.viewComposerSsh },
      { label: "History", keys: SHORTCUTS.viewComposerHistory },
      { label: "Docs", keys: SHORTCUTS.viewComposerDocs },
    ],
  },
  {
    heading: "Tools Views",
    items: [
      { label: "Syslog", keys: SHORTCUTS.viewToolsSyslog },
      { label: "Log Viewer", keys: SHORTCUTS.viewToolsLogs },
      { label: "File Server", keys: SHORTCUTS.viewToolsFileServer },
      { label: "Firmware", keys: SHORTCUTS.viewToolsFirmware },
      { label: "Password Generator", keys: SHORTCUTS.viewToolsPasswordGen },
      { label: "MCP", keys: SHORTCUTS.viewToolsMcp },
    ],
  },
];

export function ShortcutsPanel({ isOpen, onClose }: ShortcutsPanelProps) {
  const [labelMode, setLabelMode] = useState<"mac" | "generic">(() => (
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      ? "mac"
      : "generic"
  ));
  const mcpEnabled = isFeatureFlagEnabled(FEATURE_FLAG_MCP_UI, false);
  const visibleShortcutGroups = SHORTCUT_GROUPS
    .map((group) => {
      if (group.heading !== "Tools Views") return group;
      return {
        ...group,
        items: mcpEnabled
          ? group.items
          : group.items.filter((item) => item.keys !== SHORTCUTS.viewToolsMcp),
      };
    })
    .filter((group) => group.items.length > 0);
  const totalShortcuts = visibleShortcutGroups.reduce((count, group) => count + group.items.length, 0);

  const renderShortcut = (keys: string) => {
    const parts = keys
      .split("+")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
      .map((part) => {
        if (part === "ctrl") return labelMode === "mac" ? "CMD" : "CTRL";
        if (part === "shift") return "SHIFT";
        if (part === "alt") return labelMode === "mac" ? "OPT" : "ALT";
        if (part === "escape") return "Esc";
        return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
      });

    if (parts.length <= 1) {
      return (
        <kbd className="ui-keycap">
          {parts[0]}
        </kbd>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5">
        {parts.map((part, index) => (
          <span key={`${part}-${index}`} className="inline-flex items-center gap-1.5">
            {index > 0 && <span className="ui-keycap-sep">+</span>}
            <kbd className="ui-keycap">
              {part}
            </kbd>
          </span>
        ))}
      </span>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="!w-[min(98vw,1500px)] !max-w-[min(98vw,1500px)] sm:!max-w-[min(98vw,1500px)] p-0 overflow-hidden"
      >
        <DialogHeader className="ui-section-header-md px-4 py-3">
          <DialogTitle className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-border/35 bg-background/55 text-muted-foreground">
                <Keyboard className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold tracking-tight">Keyboard Shortcuts</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex h-7 items-center rounded-[var(--radius-sm)] border border-border/35 bg-background/60 p-0.5">
                <button
                  type="button"
                  onClick={() => setLabelMode("mac")}
                  aria-pressed={labelMode === "mac"}
                  className={cn(
                    "inline-flex h-6 items-center rounded-[calc(var(--radius-sm)-2px)] px-2 text-2xs font-semibold uppercase tracking-[0.08em] transition-smooth",
                    labelMode === "mac"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Mac
                </button>
                <button
                  type="button"
                  onClick={() => setLabelMode("generic")}
                  aria-pressed={labelMode === "generic"}
                  className={cn(
                    "inline-flex h-6 items-center rounded-[calc(var(--radius-sm)-2px)] px-2 text-2xs font-semibold uppercase tracking-[0.08em] transition-smooth",
                    labelMode === "generic"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Generic
                </button>
              </span>
              <span className="inline-flex h-6 items-center rounded-[var(--radius-sm)] border border-border/35 bg-background/65 px-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {totalShortcuts} shortcuts
              </span>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-border/45 bg-background/55 text-muted-foreground/85 transition-smooth hover:bg-accent hover:text-foreground"
                aria-label="Close shortcuts panel"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          </DialogTitle>
          <p className="text-2xs text-muted-foreground/75">
            Quick command map for global actions, navigation, and panel controls.
          </p>
        </DialogHeader>

        <div className="max-h-[calc(min(100vh,100dvh)-12rem)] overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleShortcutGroups.map((group) => (
              <section
                key={group.heading}
                className="ui-surface-card overflow-hidden"
              >
                <div className="ui-section-header-sm">
                  <h3 className="section-label-sm">{group.heading}</h3>
                </div>
                <div className="px-2 py-1">
                  {group.items.map(({ label, keys }, index) => (
                    <div
                      key={`${group.heading}-${label}-${keys}`}
                      className={cn(
                        "ui-data-row flex items-center justify-between gap-4 rounded-[var(--radius-sm)] px-2 py-2",
                        index === group.items.length - 1 && "border-b-0",
                      )}
                    >
                      <span className="text-[13px] font-medium text-foreground/95">{label}</span>
                      <span className="shrink-0">{renderShortcut(keys)}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-3 rounded-[var(--radius-sm)] border border-border/30 bg-background/45 px-3 py-2 text-2xs text-muted-foreground/75">
            Tip: press <span className="font-mono text-foreground/85">{shortcutLabel(SHORTCUTS.shortcutsPanel)}</span> from anywhere to reopen this panel.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
