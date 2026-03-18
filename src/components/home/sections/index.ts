import { createElement, lazy, Suspense } from "react";
import type { IconComponent } from "@/lib/icons";
import {
  Shield,
  Server,
  Activity,
  Globe,
  Gauge,
  Eye,
  StickyNote,
  AlertTriangle,
  Zap,
  History,
  Calendar,
  Lightbulb,
} from "@/lib/icons";

import { RegistrationHealthSection } from "./RegistrationHealthSection";
import { AgentFleetSection } from "./AgentFleetSection";
import { ActivityMonitorSection } from "./ActivityMonitorSection";
import { NetworkAtGlanceSection } from "./NetworkAtGlanceSection";
import { LastSpeedTestSection } from "./LastSpeedTestSection";
import { ActiveCapturesSection } from "./ActiveCapturesSection";
import { QuickNotesSection } from "./QuickNotesSection";
import { ErrorSummarySection } from "./ErrorSummarySection";
import { QuickLaunchSection } from "./QuickLaunchSection";
import { RecentSessionsSection } from "./RecentSessionsSection";
import { ScheduledTasksSection } from "./ScheduledTasksSection";
const LazyKnowledgeBaseSpotlightSection = lazy(() =>
  import("./KnowledgeBaseSpotlightSection").then((m) => ({ default: m.KnowledgeBaseSpotlightSection }))
);

function KnowledgeBaseSpotlightSection() {
  return createElement(
    Suspense,
    { fallback: null },
    createElement(LazyKnowledgeBaseSpotlightSection),
  );
}

export interface SectionDefinition {
  id: string;
  label: string;
  description: string;
  icon: IconComponent;
  defaultEnabled: boolean;
  /** When true, this section spans the full grid width instead of one column. */
  span?: "full";
  component: React.ComponentType;
}

export const SECTION_REGISTRY: SectionDefinition[] = [
  {
    id: "registration-health",
    label: "Registration Health",
    description: "Registrar status overview with health indicators",
    icon: Shield,
    defaultEnabled: true,
    component: RegistrationHealthSection,
  },
  {
    id: "agent-fleet",
    label: "Agent Fleet Status",
    description: "Connected remote agents with latency and uptime",
    icon: Server,
    defaultEnabled: true,
    component: AgentFleetSection,
  },
  {
    id: "recent-activity",
    label: "Activity Monitor",
    description: "Live monitor and event feed from all app areas",
    icon: Activity,
    defaultEnabled: true,
    span: "full",
    component: ActivityMonitorSection,
  },
  {
    id: "network-at-glance",
    label: "Network at a Glance",
    description: "Local IP, Wi-Fi signal, and network interfaces",
    icon: Globe,
    defaultEnabled: true,
    component: NetworkAtGlanceSection,
  },
  {
    id: "quick-launch",
    label: "Quick Launch",
    description: "Shortcut tiles for common actions",
    icon: Zap,
    defaultEnabled: true,
    span: "full",
    component: QuickLaunchSection,
  },
  {
    id: "last-speed-test",
    label: "Last Speed Test",
    description: "Most recent download/upload/latency results",
    icon: Gauge,
    defaultEnabled: false,
    component: LastSpeedTestSection,
  },
  {
    id: "active-captures",
    label: "Active Captures",
    description: "Running packet capture sessions",
    icon: Eye,
    defaultEnabled: false,
    component: ActiveCapturesSection,
  },
  {
    id: "quick-notes",
    label: "Quick Notes",
    description: "Recent and pinned notes at a glance",
    icon: StickyNote,
    defaultEnabled: false,
    component: QuickNotesSection,
  },
  {
    id: "error-summary",
    label: "Error Summary",
    description: "Recent errors grouped by source",
    icon: AlertTriangle,
    defaultEnabled: false,
    component: ErrorSummarySection,
  },
  {
    id: "recent-sessions",
    label: "Recent Sessions",
    description: "Last capture and composer sessions",
    icon: History,
    defaultEnabled: false,
    component: RecentSessionsSection,
  },
  {
    id: "scheduled-tasks",
    label: "Scheduled Tasks",
    description: "Upcoming scheduled captures and agent jobs",
    icon: Calendar,
    defaultEnabled: false,
    component: ScheduledTasksSection,
  },
  {
    id: "kb-spotlight",
    label: "Knowledge Base Spotlight",
    description: "Random troubleshooting tip from the knowledge base",
    icon: Lightbulb,
    defaultEnabled: false,
    component: KnowledgeBaseSpotlightSection,
  },
];

export const SECTION_MAP = new Map(SECTION_REGISTRY.map((s) => [s.id, s]));
