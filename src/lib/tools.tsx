import { lazy, Suspense } from "react";
import { toolRegistry, HOME_TOOL_ID } from "./toolRegistry";
import { Server, Network, PhoneCall, Home, Printer, FileSearch, SquareTerminal, Package, Satellite, Toolbox, Shield } from "@/lib/icons";
import type { IconComponent } from "@/lib/icons";
import styles from "./tools.module.css";

const UnifiedTroubleshootingTool = lazy(() =>
  import("@/components/troubleshooting/UnifiedTroubleshootingTool").then((m) => ({ default: m.UnifiedTroubleshootingTool }))
);
const RegistrationTool = lazy(() =>
  import("@/components/registration/RegistrationToolset").then((m) => ({ default: m.RegistrationToolset }))
);

const SoftPhoneTool = lazy(() =>
  import("@/components/soft-phone/SoftPhoneTool").then((m) => ({ default: m.SoftPhoneTool }))
);
const PacketCaptureTool = lazy(() =>
  import("@/components/packet-capture/PacketCaptureTool").then((m) => ({ default: m.PacketCaptureTool }))
);
const FaxCenterTool = lazy(() =>
  import("@/components/fax-center/FaxCenterTool").then((m) => ({ default: m.FaxCenterTool }))
);
const NetworkTool = lazy(() =>
  import("@/components/network/NetworkTool").then((m) => ({ default: m.NetworkTool }))
);
const ComposerTool = lazy(() =>
  import("@/components/composer/ComposerTool").then((m) => ({ default: m.ComposerTool }))
);
const ToolsTool = lazy(() =>
  import("@/components/tools/ToolsTool").then((m) => ({ default: m.ToolsTool }))
);
const AdminCenter = lazy(() =>
  import("@/components/admin/AdminCenter").then((m) => ({ default: m.AdminCenter }))
);
const ProvisionViewerTool = lazy(() =>
  import("@/components/tools/provision-viewer/ProvisionViewerTool").then((m) => ({ default: m.ProvisionViewerTool }))
);
// NetworkDevicesTool merged into NetworkTool
const RemoteAgentTool = lazy(() =>
  import("@/components/remote-agent/RemoteAgentTool").then((m) => ({ default: m.RemoteAgentTool }))
);
/** Visible progressive-loading shell so tool view appears immediately while lazy chunks stream in. */
function ToolFallback({
  label,
  Icon,
}: {
  label: string;
  Icon: IconComponent;
}) {
  return (
    <div className={styles.fallbackRoot}>
      <div className={styles.fallbackHeader}>
        <Icon className={styles.fallbackIcon} />
        <span className={styles.fallbackTitle}>{label}</span>
        <span className={styles.fallbackMeta}>Loading modules...</span>
      </div>
      <div className={styles.fallbackGrid}>
        <div className={`${styles.spanTwo} ${styles.skeletonSm} skeleton`} />
        <div className={`${styles.skeletonLg} skeleton`} />
        <div className={`${styles.skeletonLg} skeleton`} />
        <div className={`${styles.spanTwo} ${styles.skeletonMd} skeleton`} />
      </div>
    </div>
  );
}

export function registerTools() {
  toolRegistry.register({
    id: HOME_TOOL_ID,
    name: "Home",
    icon: Home,
    component: () => (
      <Suspense fallback={<ToolFallback label="Home" Icon={Home} />}>
        <UnifiedTroubleshootingTool />
      </Suspense>
    ),
    route: "/",
  });

  toolRegistry.register({
    id: "packet-capture",
    name: "Packet Capture",
    icon: Package,
    component: () => (
      <Suspense fallback={<ToolFallback label="Packet Capture" Icon={Package} />}>
        <PacketCaptureTool />
      </Suspense>
    ),
    route: "/packet-capture",
    subviews: [
      { id: "monitor", label: "Monitor" },
      { id: "captures", label: "Captures" },
      { id: "viewer", label: "Viewer" },
      { id: "analysis", label: "Analysis" },
      { id: "packet-diff", label: "Packet Diff" },
      { id: "remote", label: "Remote SSH" },
      { id: "scheduled", label: "Scheduled" },
    ],
  });

  toolRegistry.register({
    id: "registration",
    name: "Registration",
    icon: Server,
    component: () => (
      <Suspense fallback={<ToolFallback label="Registration" Icon={Server} />}>
        <RegistrationTool />
      </Suspense>
    ),
    route: "/registration",
  });

  toolRegistry.register({
    id: "soft-phone",
    name: "Soft Phone",
    icon: PhoneCall,
    component: () => (
      <Suspense fallback={<ToolFallback label="Soft Phone" Icon={PhoneCall} />}>
        <SoftPhoneTool />
      </Suspense>
    ),
    route: "/soft-phone",
    subviews: [
      { id: "phone", label: "Phone" },
      { id: "contacts", label: "Contacts" },
      { id: "recordings", label: "Recordings" },
    ],
  });

  toolRegistry.register({
    id: "fax-center",
    name: "Fax Center",
    icon: Printer,
    component: () => (
      <Suspense fallback={<ToolFallback label="Fax Center" Icon={Printer} />}>
        <FaxCenterTool />
      </Suspense>
    ),
    route: "/fax-center",
    subviews: [
      { id: "send", label: "Send" },
      { id: "faxes", label: "Faxes" },
    ],
  });

  toolRegistry.register({
    id: "provision-viewer",
    name: "Device Provisioning",
    icon: FileSearch,
    component: () => (
      <Suspense fallback={<ToolFallback label="Device Provisioning" Icon={FileSearch} />}>
        <ProvisionViewerTool />
      </Suspense>
    ),
    route: "/provision-viewer",
    subviews: [
      { id: "provision", label: "Provision" },
      { id: "firmware", label: "Firmware" },
      { id: "contacts", label: "Contacts" },
      { id: "device", label: "Device" },
      { id: "diff", label: "Diff" },
      { id: "designer", label: "Designer" },
    ],
  });

  toolRegistry.register({
    id: "network",
    name: "Network",
    icon: Network,
    component: () => (
      <Suspense fallback={<ToolFallback label="Network" Icon={Network} />}>
        <NetworkTool />
      </Suspense>
    ),
    route: "/network",
    subviews: [
      { id: "path-performance", label: "Routing" },
      { id: "dns-access", label: "Connectivity" },
      { id: "discovery", label: "Devices" },
      { id: "multicast", label: "Multicast" },
    ],
  });

  // ── Bottom sidebar tools ──

  toolRegistry.register({
    id: "remote-agent",
    name: "Remote Agent",
    icon: Satellite,
    component: () => (
      <Suspense fallback={<ToolFallback label="Remote Agent" Icon={Satellite} />}>
        <RemoteAgentTool />
      </Suspense>
    ),
    route: "/remote-agent",
    subviews: [
      { id: "overview", label: "Overview" },
      { id: "registry", label: "Agent Registry" },
      { id: "activity", label: "Activity" },
    ],
  });

  toolRegistry.register({
    id: "composer",
    name: "Composer",
    icon: SquareTerminal,
    component: () => (
      <Suspense fallback={<ToolFallback label="Composer" Icon={SquareTerminal} />}>
        <ComposerTool />
      </Suspense>
    ),
    route: "/composer",
    subviews: [
      { id: "requests", label: "Requests" },
      { id: "ssh", label: "SSH" },
      { id: "history", label: "History" },
      { id: "docs", label: "Docs" },
    ],
  });

  toolRegistry.register({
    id: "tools",
    name: "Tools",
    icon: Toolbox,
    component: () => (
      <Suspense fallback={<ToolFallback label="Tools" Icon={Toolbox} />}>
        <ToolsTool />
      </Suspense>
    ),
    route: "/tools",
    /** Order matches `ToolsTool` tab strip / breadcrumb (see `tabItems` there). */
    subviews: [
      { id: "syslog", label: "Syslog" },
      { id: "logs", label: "Log Viewer" },
      { id: "file-server", label: "File Server" },
      { id: "password-gen", label: "Password Generator" },
      { id: "text-forge", label: "Text Forge" },
      { id: "mockup", label: "Mockup" },
      { id: "mcp", label: "MCP" },
    ],
  });
  toolRegistry.register({
    id: "admin-center",
    name: "Admin Center",
    icon: Shield,
    hidden: true,
    component: () => (
      <Suspense fallback={<ToolFallback label="Admin Center" Icon={Shield} />}>
        <AdminCenter />
      </Suspense>
    ),
    route: "/admin-center",
  });
}

// Per-tool color hints moved to @/lib/toolColors.ts to avoid
// breaking Vite Fast Refresh (this file mixes components + constants).
