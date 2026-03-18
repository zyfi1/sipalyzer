/**
 * Workspace setup - registers all tools with the workspace registries.
 * Call this once at app initialization (before rendering).
 */

import { registerActiveContextProvider, notifyRegistryRefresh, type ActiveContextItem } from "./activeContextRegistry";
import { registerQuickAction } from "./quickActionRegistry";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { navigateTo } from "./navigation";
import { Network, PhoneCall, Printer, Server, Activity, FileSearch } from "@/lib/icons";

// Lazy imports for active card components to avoid circular dependencies
const getActiveCaptureCard = () =>
  import("@/components/workspace/ActiveCaptureCard").then((m) => m.ActiveCaptureCard);
const getActiveCallCard = () =>
  import("@/components/workspace/ActiveCallCard").then((m) => m.ActiveCallCard);
const getActiveFaxCard = () =>
  import("@/components/workspace/ActiveFaxCard").then((m) => m.ActiveFaxCard);
const getActiveTestCard = () =>
  import("@/components/workspace/ActiveTestCard").then((m) => m.ActiveTestCard);

// Cache loaded components
let ActiveCaptureCard: Awaited<ReturnType<typeof getActiveCaptureCard>> | null = null;
let ActiveCallCard: Awaited<ReturnType<typeof getActiveCallCard>> | null = null;
let ActiveFaxCard: Awaited<ReturnType<typeof getActiveFaxCard>> | null = null;
let ActiveTestCard: Awaited<ReturnType<typeof getActiveTestCard>> | null = null;

// Preload all active card components
async function preloadActiveCards() {
  [ActiveCaptureCard, ActiveCallCard, ActiveFaxCard, ActiveTestCard] = await Promise.all([
    getActiveCaptureCard(),
    getActiveCallCard(),
    getActiveFaxCard(),
    getActiveTestCard(),
  ]);
  // Notify all subscribers that components are now available
  notifyRegistryRefresh();
}

let initialized = false;

export function setupWorkspace(): void {
  if (initialized) return;
  initialized = true;

  // Preload components
  preloadActiveCards();

  // Register Packet Capture provider
  registerActiveContextProvider({
    toolId: "packet-capture",
    getActiveItems: () => {
      if (!ActiveCaptureCard) return [];
      const { runningSessionIds, sessions, activeSession, statistics } = usePacketCaptureStore.getState();
      return runningSessionIds.map((sessionId) => {
        // Look in sessions array first, fall back to activeSession if it matches
        let session = sessions.find((s) => s.id === sessionId);
        if (!session && activeSession?.id === sessionId) {
          session = activeSession;
        }
        if (!session) return null;
        const Component = ActiveCaptureCard!;
        return {
          id: `capture-${sessionId}`,
          toolId: "packet-capture",
          priority: 80,
          component: ({ onNavigate }: { onNavigate: () => void }) => (
            <Component session={session} statistics={statistics} onNavigate={onNavigate} />
          ),
        };
      }).filter(Boolean) as ActiveContextItem[];
    },
    subscribe: (cb) => usePacketCaptureStore.subscribe(cb),
  });

  // Register Soft Phone provider
  registerActiveContextProvider({
    toolId: "soft-phone",
    getActiveItems: () => {
      if (!ActiveCallCard) return [];
      const { calls } = useSoftphoneStore.getState();
      const activeCalls = calls.filter(
        (c) => c.state === "connecting" || c.state === "ringing" || c.state === "active" || c.state === "on-hold"
      );
      const Component = ActiveCallCard!;
      return activeCalls.map((call) => ({
        id: `call-${call.id}`,
        toolId: "soft-phone",
        priority: 100, // Calls are highest priority
        component: ({ onNavigate }: { onNavigate: () => void }) => (
          <Component call={call} onNavigate={onNavigate} />
        ),
      }));
    },
    subscribe: (cb) => useSoftphoneStore.subscribe(cb),
  });

  // Register Fax Center provider
  registerActiveContextProvider({
    toolId: "fax-center",
    getActiveItems: () => {
      if (!ActiveFaxCard) return [];
      const { sentFaxJobs } = useTroubleshootingStore.getState();
      const sendingJobs = (sentFaxJobs ?? []).filter(
        (j) => j.status === "pending" || j.status === "sending"
      );
      const Component = ActiveFaxCard!;
      return sendingJobs.map((job) => ({
        id: `fax-${job.id}`,
        toolId: "fax-center",
        priority: 70,
        component: ({ onNavigate }: { onNavigate: () => void }) => (
          <Component job={job} onNavigate={onNavigate} />
        ),
      }));
    },
    subscribe: (cb) => useTroubleshootingStore.subscribe(cb),
  });

  // Register Registration provider
  registerActiveContextProvider({
    toolId: "registration",
    getActiveItems: () => {
      if (!ActiveTestCard) return [];
      const { loading, bulkOperationInProgress, registrars } = useRegistrationStore.getState();
      if (!loading && !bulkOperationInProgress) return [];
      const Component = ActiveTestCard!;
      const registrarNames = registrars.map((r) => r.name);
      return [
        {
          id: "registration-test",
          toolId: "registration",
          priority: 60,
          component: ({ onNavigate }: { onNavigate: () => void }) => (
            <Component
              registrarNames={registrarNames}
              isBulk={bulkOperationInProgress}
              onNavigate={onNavigate}
            />
          ),
        },
      ];
    },
    subscribe: (cb) => useRegistrationStore.subscribe(cb),
  });

  // Register Network active context provider (monitor / VoIP assessment)
  registerActiveContextProvider({
    toolId: "network",
    getActiveItems: () => {
      const { monitorRunning, voipRunning } = useNetworkTestStore.getState();
      const items: ActiveContextItem[] = [];
      // We don't need a lazy-loaded card for these — they show in the NetworkPanel on the dashboard.
      // But register the provider so the status bar / useActiveContext knows something is active.
      if (monitorRunning) {
        items.push({
          id: "network-monitor",
          toolId: "network",
          priority: 40,
          component: () => null, // Rendered inline by NetworkPanel instead
        });
      }
      if (voipRunning) {
        items.push({
          id: "voip-assessment",
          toolId: "network",
          priority: 45,
          component: () => null, // Rendered inline by NetworkPanel instead
        });
      }
      return items;
    },
    subscribe: (cb) => useNetworkTestStore.subscribe(cb),
  });

  // Register quick actions
  registerQuickAction({
    id: "debug-call",
    toolId: "packet-capture",
    label: "Debug a call",
    description: "Start packet capture and test a call",
    icon: Network,
    priority: 100,
    onClick: () => navigateTo("packet-capture", "monitor"),
  });

  registerQuickAction({
    id: "make-call",
    toolId: "soft-phone",
    label: "Make a call",
    description: "Open Soft Phone to place a call",
    icon: PhoneCall,
    priority: 90,
    onClick: () => navigateTo("soft-phone"),
  });

  registerQuickAction({
    id: "send-fax",
    toolId: "fax-center",
    label: "Send a fax",
    description: "Open Fax Center to send a fax",
    icon: Printer,
    priority: 80,
    onClick: () => navigateTo("fax-center", "send"),
  });

  registerQuickAction({
    id: "check-health",
    toolId: "registration",
    label: "Check health",
    description: "View registrar status and run tests",
    icon: Server,
    priority: 70,
    onClick: () => navigateTo("registration"),
  });

  registerQuickAction({
    id: "network",
    toolId: "network",
    label: "Network",
    description: "Run diagnostics, VoIP assessment, and device scanning",
    icon: Activity,
    priority: 60,
    onClick: () => navigateTo("network"),
  });

  registerQuickAction({
    id: "provision-viewer",
    toolId: "provision-viewer",
    label: "Provision viewer",
    description: "Fetch and inspect device config",
    icon: FileSearch,
    priority: 50,
    onClick: () => navigateTo("provision-viewer"),
  });
}
