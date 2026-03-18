import { lazy, Suspense, useEffect, useState } from "react";
import { useToolStore } from "@/stores/toolStore";
import { ToolHeader } from "@/components/layout/ToolHeader";
import {
  ViewFooter,
  ViewFooterItem,
  ViewFooterSpacer,
  ViewFooterDivider,
} from "@/components/layout/ViewFooter";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import { cn } from "@/lib/utils";
import { Satellite, Globe } from "@/lib/icons";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";

const OverviewTab = lazy(() =>
  import("./OverviewTab").then((m) => ({ default: m.OverviewTab }))
);
const AgentRegistryTab = lazy(() =>
  import("./AgentRegistryTab").then((m) => ({ default: m.AgentRegistryTab }))
);
const ActivityView = lazy(() =>
  import("./ActivityView").then((m) => ({ default: m.ActivityView }))
);

// ── Subview constants ────────────────────────────────────────────────

const SUBVIEW_OVERVIEW = "overview";
const SUBVIEW_REGISTRY = "registry";
const SUBVIEW_ACTIVITY = "activity";

const VALID_SUBVIEWS = [
  SUBVIEW_OVERVIEW,
  SUBVIEW_REGISTRY,
  SUBVIEW_ACTIVITY,
] as const;

/** Maps removed subview IDs to their current equivalents so saved state doesn't break. */
const LEGACY_SUBVIEW_MAP: Record<string, string> = {
  connections: SUBVIEW_OVERVIEW,
  generate: SUBVIEW_REGISTRY,
  tools: SUBVIEW_REGISTRY,
  schedule: SUBVIEW_ACTIVITY,
  logs: SUBVIEW_ACTIVITY,
  chat: SUBVIEW_REGISTRY,
};

function RemoteSubviewFallback({ label }: { label: string }) {
  return (
    <div className="surface-flat flex-1 min-h-0 p-3">
      <div className="text-xs text-muted-foreground mb-3">{label} loading...</div>
      <div className="h-8 skeleton mb-3" />
      <div className="h-28 skeleton mb-3" />
      <div className="h-24 skeleton" />
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────

export function RemoteAgentTool() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);
  const [activeTab, setActiveTab] = useState<string>(SUBVIEW_OVERVIEW);

  const connections = useRemoteAgentStore((s) => s.connections);
  const pendingCommands = useRemoteAgentStore((s) => s.pendingCommands);
  const generatedConfigs = useRemoteAgentStore((s) => s.generatedConfigs);
  const activeRelaySessions = useRemoteAgentStore((s) => s.activeRelaySessions);

  const relayActive = activeRelaySessions.size > 0;
  const onlineCount = connections.filter((c) => c.status === "connected").length;
  const activeCommandCount = pendingCommands.filter(
    (c) => c.status === "running" || c.status === "pending"
  ).length;

  // Sync external navigation (e.g. from notifications or widgets)
  useEffect(() => {
    if (activeToolId !== "remote-agent") return;
    if (!activeSubviewId) return;

    const resolved = LEGACY_SUBVIEW_MAP[activeSubviewId] ?? activeSubviewId;
    const isValidSubview = VALID_SUBVIEWS.includes(
      resolved as (typeof VALID_SUBVIEWS)[number],
    );
    if (isValidSubview) {
      setActiveTab(resolved);
      setLastViewedSubview("remote-agent", resolved);
    }
    setActiveSubview(null);
  }, [
    activeToolId,
    activeSubviewId,
    setActiveSubview,
    setLastViewedSubview,
  ]);

  useEffect(() => {
    setLastViewedSubview("remote-agent", activeTab);
  }, [activeTab, setLastViewedSubview]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v)}
        className="flex-1 flex flex-col gap-0 overflow-hidden"
      >
        <ToolHeader
          toolId="remote-agent"
          items={[
            { id: SUBVIEW_OVERVIEW, label: "Overview" },
            { id: SUBVIEW_REGISTRY, label: "Agent Registry" },
            { id: SUBVIEW_ACTIVITY, label: "Activity" },
          ]}
          value={activeTab}
          onValueChange={(v) => setActiveTab(v)}
        />

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <TabsContent
            value={SUBVIEW_OVERVIEW}
            className={cn(
              TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS,
              "flex flex-col min-h-0 flex-1"
            )}
          >
            <div className="flex-1 min-h-0 flex flex-col app-view-gutter">
              <Suspense fallback={<RemoteSubviewFallback label="Overview" />}>
                <OverviewTab pollingEnabled={activeTab === SUBVIEW_OVERVIEW} />
              </Suspense>
            </div>
          </TabsContent>

          <TabsContent
            value={SUBVIEW_REGISTRY}
            className={cn(
              TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS,
              "flex flex-col min-h-0 flex-1"
            )}
          >
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col app-view-gutter">
              <Suspense fallback={<RemoteSubviewFallback label="Agent Registry" />}>
                <AgentRegistryTab pollingEnabled={activeTab === SUBVIEW_REGISTRY} />
              </Suspense>
            </div>
          </TabsContent>

          <TabsContent
            value={SUBVIEW_ACTIVITY}
            className={cn(
              TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS,
              "flex flex-col min-h-0 flex-1"
            )}
          >
            <Suspense fallback={<RemoteSubviewFallback label="Activity" />}>
              <ActivityView />
            </Suspense>
          </TabsContent>

        </div>

        <ViewFooter>
          {activeTab === SUBVIEW_OVERVIEW ? (
            <>
              <ViewFooterItem>
                <Globe className="h-3 w-3" />
                <span
                  className={cn(
                    "inline-block w-2 h-2 rounded-full",
                    relayActive ? "bg-success" : "bg-muted-foreground/40"
                  )}
                />
                <span>{relayActive ? "Relay active" : "Relay idle"}</span>
              </ViewFooterItem>
              <ViewFooterDivider />
              <ViewFooterItem>
                <Satellite className="h-3 w-3" />
                <span className="tabular-nums">{onlineCount}</span>
                <span>online</span>
              </ViewFooterItem>
              {activeCommandCount > 0 && (
                <>
                  <ViewFooterDivider />
                  <ViewFooterItem>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-live-breathe motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                    </span>
                    <span className="tabular-nums">{activeCommandCount}</span>
                    <span>active</span>
                  </ViewFooterItem>
                </>
              )}
              <ViewFooterSpacer />
              <ViewFooterItem>
                <span className="tabular-nums">{generatedConfigs.length}</span>
                <span>deployed</span>
              </ViewFooterItem>
            </>
          ) : null}

          {activeTab === SUBVIEW_REGISTRY ? (
            <>
              <ViewFooterItem>
                <Satellite className="h-3 w-3" />
                <span className="tabular-nums">{connections.length}</span>
                <span>agents</span>
              </ViewFooterItem>
              <ViewFooterDivider />
              <ViewFooterItem>
                <span className="tabular-nums">{onlineCount}</span>
                <span>online</span>
              </ViewFooterItem>
              <ViewFooterSpacer />
              <ViewFooterItem>
                <span className="tabular-nums">{generatedConfigs.length}</span>
                <span>deployed</span>
              </ViewFooterItem>
            </>
          ) : null}

          {activeTab === SUBVIEW_ACTIVITY ? (
            <>
              <ViewFooterItem>
                <span className="tabular-nums">{activeCommandCount}</span>
                <span>active command{activeCommandCount === 1 ? "" : "s"}</span>
              </ViewFooterItem>
              <ViewFooterDivider />
              <ViewFooterItem>
                <span className="tabular-nums">{pendingCommands.length}</span>
                <span>queued</span>
              </ViewFooterItem>
              <ViewFooterSpacer />
              <ViewFooterItem>
                <Globe className="h-3 w-3" />
                <span>{relayActive ? "Relay active" : "Relay idle"}</span>
              </ViewFooterItem>
            </>
          ) : null}
        </ViewFooter>
      </Tabs>
    </div>
  );
}
