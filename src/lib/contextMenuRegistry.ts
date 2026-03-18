/**
 * Registry for app-wide contextual right-click menu items.
 *
 * Truly smart & contextual:
 *   - Highlights the current tool in the Navigate submenu
 *   - Shows subview-specific actions when on a particular subview
 *   - Provides destructive styling on dangerous actions
 *   - Reflects live state (active calls, running scans, monitor status)
 *
 * Tool IDs match the current toolRegistry exactly:
 *   home, packet-capture, registration, soft-phone, fax-center,
 *   provision-viewer, network, packet-monitor, remote-agent, composer, tools
 */

import {
  Home,
  Network,
  Server,
  PhoneCall,
  Printer,
  Search,
  Keyboard,
  Settings,
  FileText,
  FolderOpen,
  Layers,
  Clock,
  Eraser,
  Scissors,
  Copy,
  ClipboardPaste,
  Square,
  Bell,
  StickyNote,
  RefreshCw,
  Download,
  Play,
  BarChart3,
  Activity,
  Trash2,
  Globe,
  FileSearch,
  Terminal,
  TestTube,
  Mic,
  Shield,
  Zap,
  Phone,
  PhoneOff,
  Pause,
  ArrowRightLeft,
  Hash,
  Power,
  Package,
  Scan,
  Satellite,
  Wrench,
  Toolbox,
} from "@/lib/icons";
import { navigateTo } from "./navigation";
import { toolRegistry, HOME_TOOL_ID } from "./toolRegistry";
import { SHORTCUTS, shortcutLabel } from "./shortcuts";
import { useLayoutStore } from "@/stores/layoutStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useComposerStore } from "@/stores/composerStore";
import { handleCut, handleCopy, handlePaste, handleSelectAll } from "./standardEditActions";
import type { ContextMenuSection, ContextMenuContext, ContextMenuSubmenu, ContextMenuItemAction } from "@/types/contextMenu";

/* ================================================================== */
/*  Edit (Cut / Copy / Paste / Select All) — always first             */
/* ================================================================== */
function editSection(ctx: ContextMenuContext): ContextMenuSection {
  return {
    id: "edit",
    entries: [
      {
        id: "cut",
        label: "Cut",
        icon: Scissors,
        shortcut: "⌘X",
        disabled: !ctx.capabilities.canCut,
        disabledReason: !ctx.capabilities.canCut ? "Read-only" : undefined,
        onClick: handleCut,
      },
      {
        id: "copy",
        label: "Copy",
        icon: Copy,
        shortcut: "⌘C",
        disabled: !ctx.capabilities.canCopy,
        disabledReason: !ctx.capabilities.canCopy ? "Unavailable" : undefined,
        onClick: handleCopy,
      },
      {
        id: "paste",
        label: "Paste",
        icon: ClipboardPaste,
        shortcut: "⌘V",
        disabled: !ctx.capabilities.canPaste,
        disabledReason: !ctx.capabilities.canPaste ? "No insertion point" : undefined,
        onClick: handlePaste,
      },
      {
        id: "select-all",
        label: "Select All",
        icon: Square,
        shortcut: "⌘A",
        disabled: !ctx.capabilities.canSelectAll,
        disabledReason: !ctx.capabilities.canSelectAll ? "Not selectable" : undefined,
        onClick: handleSelectAll,
      },
    ],
  };
}

function toolViewsSubmenu(ctx: ContextMenuContext, toolId: string): ContextMenuSubmenu | null {
  const tool = toolRegistry.get(toolId);
  if (!tool?.subviews?.length) return null;
  return {
    id: `${toolId}-views`,
    label: "Views",
    icon: Layers,
    children: tool.subviews.map((sv) => ({
      id: `${toolId}-view-${sv.id}`,
      label: sv.label,
      active: ctx.subviewId === sv.id,
      onClick: () => navigateTo(toolId, sv.id),
    })),
  };
}

function dangerSubmenu(id: string, children: ContextMenuItemAction[]): ContextMenuSubmenu {
  return {
    id,
    label: "Danger",
    icon: Trash2,
    children,
  };
}

/* ================================================================== */
/*  Navigate ▸ — every tool, with active indicator                    */
/* ================================================================== */
function navSection(ctx: ContextMenuContext): ContextMenuSection {
  const tools = toolRegistry.getAll().filter((tool) => !tool.hidden);

  const iconMap: Record<string, typeof Home> = {
    [HOME_TOOL_ID]: Home,
    "packet-capture": Package,
    registration: Server,
    "soft-phone": PhoneCall,
    "fax-center": Printer,
    "provision-viewer": FileSearch,
    network: Network,
    "remote-agent": Satellite,
    composer: Wrench,
    tools: Toolbox,
  };

  const shortcutMap: Record<string, string | undefined> = {
    [HOME_TOOL_ID]: shortcutLabel(SHORTCUTS.goHome),
    "packet-capture": shortcutLabel(SHORTCUTS.goPacketCapture),
    registration: shortcutLabel(SHORTCUTS.goRegistration),
    "soft-phone": shortcutLabel(SHORTCUTS.goSoftPhone),
    "fax-center": shortcutLabel(SHORTCUTS.goFaxCenter),
    "provision-viewer": shortcutLabel(SHORTCUTS.goProvisionViewer),
    network: shortcutLabel(SHORTCUTS.goNetworkTest),
  };

  const children: ContextMenuItemAction[] = tools.map((tool) => ({
    id: `nav-${tool.id}`,
    label: tool.name,
    icon: iconMap[tool.id] ?? Activity,
    shortcut: shortcutMap[tool.id],
    active: ctx.toolId === tool.id,
    onClick: () => navigateTo(tool.id, tool.subviews?.[0]?.id ?? undefined),
  }));

  return {
    id: "navigate",
    entries: [{ id: "nav-sub", label: "Navigate", icon: Globe, children } satisfies ContextMenuSubmenu],
  };
}

/* ================================================================== */
/*  App actions — overlays, search, terminal, refresh                 */
/* ================================================================== */
function appSection(ctx: ContextMenuContext): ContextMenuSection {
  const layout = useLayoutStore.getState();
  return {
    id: "app",
    entries: [
      {
        id: "search",
        label: "Open Command Palette",
        icon: Search,
        shortcut: shortcutLabel(SHORTCUTS.search),
        onClick: () => layout.setSearchOpen(true),
      },
      {
        id: "shortcuts",
        label: "Open Keyboard Shortcuts",
        icon: Keyboard,
        shortcut: shortcutLabel(SHORTCUTS.shortcutsPanel),
        onClick: () => layout.setShortcutsPanelOpen(true),
      },
      {
        id: "settings",
        label: "Open Settings",
        icon: Settings,
        shortcut: shortcutLabel(SHORTCUTS.openSettings),
        onClick: () => layout.setSettingsCenterOpen(true),
      },
      {
        id: "notifications",
        label: "Open Notifications",
        icon: Bell,
        shortcut: shortcutLabel(SHORTCUTS.openNotifications),
        onClick: () => layout.setNotificationsCenterOpen(true),
      },
      {
        id: "notes",
        label: "Open Notes",
        icon: StickyNote,
        shortcut: shortcutLabel(SHORTCUTS.openNotes),
        onClick: () => layout.setNotesCenterOpen(true),
      },
      {
        id: "terminal",
        label: layout.terminalOpen ? "Hide Terminal" : "Open Terminal",
        icon: Terminal,
        onClick: () => layout.setTerminalOpen(!layout.terminalOpen),
      },
      {
        id: "refresh-ui",
        label: "Reload App",
        icon: RefreshCw,
        shortcut: shortcutLabel(SHORTCUTS.refreshUi),
        loading: ctx.runtime.isBusy,
        onClick: () => layout.triggerReload(),
      },
    ],
  };
}

/* ================================================================== */
/*  Home / Troubleshooting                                            */
/* ================================================================== */
function homeSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== HOME_TOOL_ID) return null;
  const ts = useTroubleshootingStore.getState();
  const sp = useSoftphoneStore.getState();

  const viewsSubmenu: ContextMenuSubmenu = {
    id: "home-views",
    label: "Views",
    icon: Layers,
    children: [
      { id: "hv-timeline", label: "Timeline", icon: Clock, active: ctx.subviewId === "timeline", onClick: () => navigateTo(HOME_TOOL_ID, "timeline") },
      { id: "hv-findings", label: "Findings", icon: FileText, active: ctx.subviewId === "findings", onClick: () => navigateTo(HOME_TOOL_ID, "findings") },
      { id: "hv-calls", label: "Call Quality", icon: PhoneCall, active: ctx.subviewId === "calls", onClick: () => navigateTo(HOME_TOOL_ID, "calls") },
    ],
  };

  const actionsSubmenu: ContextMenuSubmenu = {
    id: "home-data",
    label: "Actions",
    icon: Eraser,
    children: [
      { id: "hd-timeline", label: "Clear Timeline", icon: Eraser, onClick: () => ts.clearTimeline() },
      { id: "hd-captures", label: "Clear Captures", icon: Eraser, onClick: () => ts.setCaptureSessions([]) },
      { id: "hd-trace", label: "Clear Trace / Findings", icon: Eraser, onClick: () => ts.clearTrace() },
    ],
  };
  const danger = dangerSubmenu("home-danger", [
    {
      id: "hd-all",
      label: "Clear Everything",
      icon: Trash2,
      destructive: true,
      shortcut: shortcutLabel(SHORTCUTS.clearAllViews),
      onClick: () => { ts.clearTrace(); ts.clearTimeline(); ts.setCaptureSessions([]); sp.clearCalls(); },
    },
  ]);

  return { id: "home-ctx", entries: [viewsSubmenu, actionsSubmenu, danger] };
}

/* ================================================================== */
/*  Packet Capture                                                    */
/* ================================================================== */
function packetSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== "packet-capture") return null;
  const pc = usePacketCaptureStore.getState();
  const viewsSubmenu = toolViewsSubmenu(ctx, "packet-capture");

  const actionsSubmenu: ContextMenuSubmenu = {
    id: "pc-actions",
    label: "Actions",
    icon: Play,
    children: [
      { id: "pcc-refresh", label: "Refresh Sessions", icon: RefreshCw, onClick: () => pc.fetchSessions() },
      {
        id: "pcc-export",
        label: "Export PCAP",
        icon: Download,
        disabled: !pc.activeSessionId,
        onClick: () => { if (pc.activeSessionId) pc.exportPcap(pc.activeSessionId); },
      },
      {
        id: "pcc-stats",
        label: "Refresh Statistics",
        icon: BarChart3,
        disabled: !pc.activeSessionId,
        onClick: () => { if (pc.activeSessionId) pc.fetchStatistics(pc.activeSessionId); },
      },
    ],
  };
  const danger = dangerSubmenu("packet-danger", [
    {
      id: "pcc-delete-all",
      label: "Delete All Sessions",
      icon: Trash2,
      destructive: true,
      onClick: () => pc.deleteAllSessions(),
    },
  ]);

  return { id: "packet-ctx", entries: viewsSubmenu ? [viewsSubmenu, actionsSubmenu, danger] : [actionsSubmenu, danger] };
}

/* ================================================================== */
/*  Packet Monitor (subview of Packet Capture)                        */
/* ================================================================== */
function packetMonitorSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== "packet-capture" || ctx.subviewId !== "monitor") return null;
  const pc = usePacketCaptureStore.getState();

  return {
    id: "pktmon-ctx",
    entries: [
      { id: "pm-refresh", label: "Refresh Sessions", icon: RefreshCw, onClick: () => pc.fetchSessions() },
      { id: "pm-interfaces", label: "Refresh Interfaces", icon: Network, onClick: () => pc.fetchInterfaces() },
      {
        id: "pm-export",
        label: "Export PCAP",
        icon: Download,
        disabled: !pc.activeSessionId,
        onClick: () => { if (pc.activeSessionId) pc.exportPcap(pc.activeSessionId); },
      },
    ],
  };
}

/* ================================================================== */
/*  Registration                                                      */
/* ================================================================== */
function registrationSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== "registration") return null;
  const reg = useRegistrationStore.getState();

  const actionsSubmenu: ContextMenuSubmenu = {
    id: "reg-actions",
    label: "Actions",
    icon: Wrench,
    children: [
      { id: "ra-refresh", label: "Refresh Registrars", icon: RefreshCw, onClick: () => reg.fetchRegistrars() },
      { id: "ra-folders", label: "Refresh Folders", icon: FolderOpen, onClick: () => reg.fetchFolders() },
    ],
  };

  return { id: "reg-ctx", entries: [actionsSubmenu] };
}

/* ================================================================== */
/*  Soft Phone                                                        */
/* ================================================================== */
function softPhoneSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== "soft-phone") return null;
  const sp = useSoftphoneStore.getState();

  const activeCall = sp.calls.find((c) => c.id === sp.activeCallId);
  const hasActiveCall = !!activeCall && activeCall.state === "active";
  const isOnHold = !!activeCall && activeCall.state === "on-hold";
  const hasRingingCall = sp.calls.some((c) => c.isInbound && c.state === "ringing");

  const viewsSubmenu = toolViewsSubmenu(ctx, "soft-phone");

  const callActions: ContextMenuSubmenu = {
    id: "sp-calls",
    label: "Actions",
    icon: Phone,
    children: [
      {
        id: "sp-hold",
        label: isOnHold ? "Resume Call" : "Hold Call",
        icon: Pause,
        disabled: !hasActiveCall && !isOnHold,
        onClick: () => { if (activeCall) sp.holdCall(activeCall.id, !isOnHold); },
      },
      {
        id: "sp-mute",
        label: activeCall?.muted ? "Unmute" : "Mute",
        icon: Mic,
        disabled: !hasActiveCall,
        onClick: () => { if (activeCall) sp.muteCall(activeCall.id, !activeCall.muted); },
      },
      {
        id: "sp-answer",
        label: "Answer Incoming Call",
        icon: PhoneCall,
        disabled: !hasRingingCall,
        onClick: () => {
          const ring = sp.calls.find((c) => c.isInbound && c.state === "ringing");
          if (ring) sp.answerInboundCall(ring.id);
        },
      },
    ],
  };
  const danger = dangerSubmenu("softphone-danger", [
    {
      id: "sp-end",
      label: "End Call",
      icon: PhoneOff,
      disabled: !hasActiveCall && !isOnHold,
      destructive: true,
      onClick: () => { if (activeCall) sp.endCall(activeCall.id); },
    },
    {
      id: "sp-reject",
      label: "Reject Incoming Call",
      icon: PhoneOff,
      disabled: !hasRingingCall,
      destructive: true,
      onClick: () => {
        const ring = sp.calls.find((c) => c.isInbound && c.state === "ringing");
        if (ring) sp.rejectInboundCall(ring.id);
      },
    },
    { id: "sp-clear-calls", label: "Clear Call History", icon: Trash2, destructive: true, onClick: () => sp.clearCalls() },
  ]);

  const entries: (ContextMenuSubmenu | ContextMenuItemAction)[] = [callActions, danger];
  if (viewsSubmenu) entries.unshift(viewsSubmenu);
  return { id: "softphone-ctx", entries };
}

/* ================================================================== */
/*  Fax Center                                                        */
/* ================================================================== */
function faxSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== "fax-center") return null;
  const viewsSubmenu = toolViewsSubmenu(ctx, "fax-center");
  if (!viewsSubmenu) return null;
  return { id: "fax-ctx", entries: [viewsSubmenu] };
}

/* ================================================================== */
/*  Device Provisioning                                               */
/* ================================================================== */
function provisionSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== "provision-viewer") return null;
  const viewsSubmenu = toolViewsSubmenu(ctx, "provision-viewer");
  if (!viewsSubmenu) return null;
  return { id: "prov-ctx", entries: [viewsSubmenu] };
}

const NETWORK_PATH_SUBVIEWS = new Set(["path-performance", "connectivity", "path", "overview"]);
const NETWORK_DNS_SUBVIEWS = new Set(["dns-access", "probe", "access", "voip"]);
const NETWORK_DISCOVERY_SUBVIEWS = new Set(["discovery", "devices"]);
const NETWORK_MULTICAST_SUBVIEWS = new Set(["multicast", "media", "devices-media"]);

/* ================================================================== */
/*  Network (unified: path/dns/discovery/media)                       */
/* ================================================================== */
function networkSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== "network") return null;
  const nt = useNetworkTestStore.getState();
  const nd = useNetworkDevicesStore.getState();
  const viewsSubmenu = toolViewsSubmenu(ctx, "network");

  const quickTools: ContextMenuSubmenu = {
    id: "net-quick",
    label: "Actions",
    icon: Zap,
    children: [
      { id: "net-ping", label: "Run Ping", icon: Activity, onClick: () => nt.runPing("8.8.8.8") },
      { id: "net-traceroute", label: "Run Traceroute", icon: Globe, onClick: () => nt.runTraceroute("8.8.8.8") },
      { id: "net-dns", label: "Run DNS Lookup", icon: Search, onClick: () => nt.runDns("google.com") },
      { id: "net-mtu", label: "Run MTU Discovery", icon: ArrowRightLeft, onClick: () => nt.runMtu("8.8.8.8") },
      { id: "net-stun", label: "Run STUN/NAT Detection", icon: Shield, onClick: () => nt.runStun() },
    ],
  };

  const voipTools: ContextMenuSubmenu = {
    id: "net-voip-tools",
    label: "VoIP Actions",
    icon: TestTube,
    children: [
      { id: "net-voip-assessment", label: "Run Full VoIP Assessment", icon: Play, onClick: () => nt.runVoipAssessment() },
      { id: "net-voip-ping", label: "Run Call Quality Test", icon: Activity, onClick: () => nt.runVoipPing() },
      { id: "net-voip-ports", label: "Run SIP Port Scan", icon: Hash, onClick: () => nt.runVoipPortScan() },
      { id: "net-voip-dns", label: "Run SIP DNS Lookup", icon: Search, onClick: () => nt.runVoipDns() },
      { id: "net-voip-dscp", label: "Run DSCP/QoS Check", icon: Shield, onClick: () => nt.runVoipDscp() },
    ],
  };

  const monitorSubmenu: ContextMenuSubmenu = {
    id: "net-monitor",
    label: "Monitor",
    icon: RefreshCw,
    children: [
      { id: "net-mon-start", label: "Start Monitor", icon: Play, disabled: nt.monitorRunning, onClick: () => nt.startMonitor("8.8.8.8") },
      { id: "net-mon-stop", label: "Stop Monitor", icon: Power, disabled: !nt.monitorRunning, onClick: () => nt.stopMonitor() },
      { id: "net-mon-clear", label: "Clear Samples", icon: Eraser, onClick: () => nt.clearMonitorSamples() },
    ],
  };

  const deviceActions: ContextMenuSubmenu = {
    id: "net-dev-actions",
    label: "Device Actions",
    icon: Scan,
    children: [
      {
        id: "net-scan-toggle",
        label: nd.status === "running" ? "Stop Scan" : "Start Scan",
        icon: nd.status === "running" ? Power : Play,
        onClick: () => { nd.status === "running" ? nd.stopScan() : nd.startScan(); },
      },
      { id: "net-clear-results", label: "Clear Results", icon: Eraser, onClick: () => nd.clearResults() },
    ],
  };
  const danger = dangerSubmenu("network-danger", [
    { id: "net-clear-history", label: "Clear History", icon: Trash2, destructive: true, onClick: () => nd.clearHistory() },
  ]);

  // Contextual: show different action groups based on the active subview
  const entries: (ContextMenuSubmenu | ContextMenuItemAction)[] = [];
  if (viewsSubmenu) entries.push(viewsSubmenu);
  if (ctx.subviewId && NETWORK_DISCOVERY_SUBVIEWS.has(ctx.subviewId)) {
    entries.push(deviceActions);
  } else if (ctx.subviewId && NETWORK_MULTICAST_SUBVIEWS.has(ctx.subviewId)) {
    entries.push(quickTools, monitorSubmenu);
  } else if (ctx.subviewId && NETWORK_DNS_SUBVIEWS.has(ctx.subviewId)) {
    entries.push(quickTools, voipTools, monitorSubmenu);
  } else if (ctx.subviewId && NETWORK_PATH_SUBVIEWS.has(ctx.subviewId)) {
    entries.push(quickTools, monitorSubmenu);
  } else {
    entries.push(quickTools, voipTools, monitorSubmenu, deviceActions);
  }
  entries.push(danger);

  return { id: "network-ctx", entries };
}

/* ================================================================== */
/*  Remote Agent                                                      */
/* ================================================================== */
function remoteAgentSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== "remote-agent") return null;
  const ra = useRemoteAgentStore.getState();
  const viewsSubmenu = toolViewsSubmenu(ctx, "remote-agent");

  const actionsSubmenu: ContextMenuSubmenu = {
    id: "ra-actions",
    label: "Actions",
    icon: Wrench,
    children: [
      { id: "ra-refresh", label: "Refresh Connections", icon: RefreshCw, onClick: () => ra.refreshConnections() },
      { id: "ra-clear-log", label: "Clear Activity Log", icon: Eraser, onClick: () => ra.clearActivityLog() },
    ],
  };
  const danger = dangerSubmenu("remote-danger", [
    { id: "ra-clear-configs", label: "Clear Generated Configs", icon: Trash2, destructive: true, onClick: () => ra.clearGeneratedConfigs() },
  ]);

  return { id: "remote-ctx", entries: viewsSubmenu ? [viewsSubmenu, actionsSubmenu, danger] : [actionsSubmenu, danger] };
}

/* ================================================================== */
/*  Composer (SSH + Requests)                                         */
/* ================================================================== */
function composerSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== "composer") return null;
  const cs = useComposerStore.getState();
  const viewsSubmenu = toolViewsSubmenu(ctx, "composer");

  const actionsSubmenu: ContextMenuSubmenu = {
    id: "cs-actions",
    label: "Actions",
    icon: Wrench,
    children: [
      { id: "cs-reset-sip", label: "Reset SIP Draft", icon: Eraser, onClick: () => cs.resetSipDraft() },
      { id: "cs-reset-http", label: "Reset HTTP Draft", icon: Eraser, onClick: () => cs.resetHttpDraft() },
    ],
  };
  const danger = dangerSubmenu("composer-danger", [
    { id: "cs-clear-history", label: "Clear History", icon: Trash2, destructive: true, onClick: () => cs.clearHistory() },
  ]);

  return { id: "composer-ctx", entries: viewsSubmenu ? [viewsSubmenu, actionsSubmenu, danger] : [actionsSubmenu, danger] };
}

/* ================================================================== */
/*  Tools (Syslog, Log Viewer, File Server, Password Gen)             */
/* ================================================================== */
function toolsSection(ctx: ContextMenuContext): ContextMenuSection | null {
  if (ctx.toolId !== "tools") return null;
  const viewsSubmenu = toolViewsSubmenu(ctx, "tools");
  if (!viewsSubmenu) return null;
  return { id: "tools-ctx", entries: [viewsSubmenu] };
}

/* ================================================================== */
/*  Assemble: Edit → Tool-specific → Navigate ▸ → App                */
/* ================================================================== */
export function getContextMenuSections(ctx: ContextMenuContext): ContextMenuSection[] {
  const softphone = useSoftphoneStore.getState();
  const packetCapture = usePacketCaptureStore.getState();
  const netTest = useNetworkTestStore.getState();
  const effectiveCtx: ContextMenuContext = {
    ...ctx,
    runtime: {
      ...ctx.runtime,
      hasActiveCall: ctx.runtime.hasActiveCall || softphone.calls.some((c) => c.state === "active" || c.state === "on-hold"),
      hasCaptureSession: ctx.runtime.hasCaptureSession || !!packetCapture.activeSessionId,
      isBusy: ctx.runtime.isBusy || netTest.monitorRunning,
      isConnected: ctx.runtime.isConnected || !!softphone.activeRegistrarId,
    },
  };

  const sections: ContextMenuSection[] = [editSection(effectiveCtx)];

  const toolFns = [
    homeSection,
    packetSection,
    packetMonitorSection,
    registrationSection,
    softPhoneSection,
    faxSection,
    provisionSection,
    networkSection,
    remoteAgentSection,
    composerSection,
    toolsSection,
  ];

  for (const fn of toolFns) {
    const s = fn(effectiveCtx);
    if (s) { sections.push(s); break; }
  }

  sections.push(navSection(effectiveCtx));
  sections.push(appSection(effectiveCtx));
  return sections;
}
