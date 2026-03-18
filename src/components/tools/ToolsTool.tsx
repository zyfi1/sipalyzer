import { useEffect, useState, useMemo } from "react";
import { useToolStore } from "@/stores/toolStore";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { ViewFooter, ViewFooterItem, ViewFooterSpacer } from "@/components/layout/ViewFooter";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import { cn } from "@/lib/utils";
import { Activity } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAG_MCP_UI } from "@/lib/featureFlags";

import { SyslogView } from "@/components/tools/syslog/SyslogView";
import { LogViewerView } from "@/components/tools/log-viewer/LogViewerView";
import { FileServerView } from "@/components/tools/file-server/FileServerView";
import { PasswordGeneratorView } from "@/components/tools/password-gen/PasswordGeneratorView";
import { FirmwareCatalogView } from "@/components/tools/firmware-catalog/FirmwareCatalogView";
import { McpView } from "@/components/tools/mcp/McpView";
import { TextForgeView } from "@/components/tools/text-forge/TextForgeView";

const SUBVIEW_SYSLOG = "syslog";
const SUBVIEW_LOGS = "logs";
const SUBVIEW_FILE_SERVER = "file-server";
const SUBVIEW_PASSWORD_GEN = "password-gen";
const SUBVIEW_FIRMWARE = "firmware";
const SUBVIEW_TEXT_FORGE = "text-forge";
const SUBVIEW_MCP = "mcp";

const TOOL_ID = "tools";

const EXEC_CONTEXT_MAP: Record<string, string> = {
  [SUBVIEW_SYSLOG]: "toolsSyslog",
  [SUBVIEW_LOGS]: "toolsLogs",
  [SUBVIEW_FILE_SERVER]: "toolsFileServer",
  [SUBVIEW_FIRMWARE]: "toolsFirmware",
  [SUBVIEW_MCP]: "toolsMcp",
};

export function ToolsTool() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);
  const [activeTab, setActiveTab] = useState<string>(SUBVIEW_SYSLOG);
  const { enabled: mcpEnabled } = useFeatureFlag(FEATURE_FLAG_MCP_UI);

  const connectedAgents = useRemoteAgentStore((s) => s.connections.length);
  const pendingCommands = useRemoteAgentStore((s) => s.pendingCommands);

  const activeToolCommands = pendingCommands.filter(
    (c) => c.status === "running" && ["SyslogListen", "TailLog", "FileServe", "FirmwareDownload"].includes(c.type),
  );

  const execContextToolId = useMemo(
    () => EXEC_CONTEXT_MAP[activeTab],
    [activeTab],
  );
  const validTabs = useMemo(
    () =>
      mcpEnabled
        ? [SUBVIEW_SYSLOG, SUBVIEW_LOGS, SUBVIEW_FILE_SERVER, SUBVIEW_PASSWORD_GEN, SUBVIEW_FIRMWARE, SUBVIEW_TEXT_FORGE, SUBVIEW_MCP]
        : [SUBVIEW_SYSLOG, SUBVIEW_LOGS, SUBVIEW_FILE_SERVER, SUBVIEW_PASSWORD_GEN, SUBVIEW_FIRMWARE, SUBVIEW_TEXT_FORGE],
    [mcpEnabled],
  );
  const tabItems = useMemo(() => {
    const baseItems = [
      { id: SUBVIEW_SYSLOG, label: "Syslog" },
      { id: SUBVIEW_LOGS, label: "Log Viewer" },
      { id: SUBVIEW_FILE_SERVER, label: "File Server" },
      { id: SUBVIEW_PASSWORD_GEN, label: "Password Generator" },
      { id: SUBVIEW_FIRMWARE, label: "Firmware" },
      { id: SUBVIEW_TEXT_FORGE, label: "Text Forge" },
    ];
    if (mcpEnabled) {
      baseItems.push({ id: SUBVIEW_MCP, label: "MCP" });
    }
    return baseItems;
  }, [mcpEnabled]);

  useEffect(() => {
    if (activeToolId !== TOOL_ID) return;
    if (!activeSubviewId) return;
    if (validTabs.includes(activeSubviewId)) {
      setActiveTab(activeSubviewId);
      setLastViewedSubview(TOOL_ID, activeSubviewId);
    }
    setActiveSubview(null);
  }, [activeToolId, activeSubviewId, setActiveSubview, setLastViewedSubview, validTabs]);

  useEffect(() => {
    setLastViewedSubview(TOOL_ID, activeTab);
  }, [activeTab, setLastViewedSubview]);

  useEffect(() => {
    if (!mcpEnabled && activeTab === SUBVIEW_MCP) {
      setActiveTab(SUBVIEW_SYSLOG);
      setLastViewedSubview(TOOL_ID, SUBVIEW_SYSLOG);
    }
  }, [mcpEnabled, activeTab, setLastViewedSubview]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)} className="flex-1 flex flex-col gap-0 overflow-hidden">
        <ToolHeader
          toolId={TOOL_ID}
          execToolId={activeTab !== SUBVIEW_PASSWORD_GEN ? execContextToolId : undefined}
          items={tabItems}
          value={activeTab}
          onValueChange={(v) => setActiveTab(v)}
        />

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <TabsContent value={SUBVIEW_SYSLOG} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <SyslogView />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_LOGS} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <LogViewerView />
            </div>
          </TabsContent>
          <TabsContent
            value={SUBVIEW_FILE_SERVER}
            forceMount
            className={cn(
              TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS,
              "data-[state=inactive]:hidden flex flex-col min-h-0 flex-1"
            )}
          >
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <FileServerView toolId={TOOL_ID} />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_PASSWORD_GEN} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <PasswordGeneratorView />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_FIRMWARE} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <FirmwareCatalogView />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_TEXT_FORGE} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <TextForgeView />
            </div>
          </TabsContent>
          {mcpEnabled ? (
            <TabsContent value={SUBVIEW_MCP} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
              <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
                <McpView />
              </div>
            </TabsContent>
          ) : null}
        </div>

        <ViewFooter>
          {activeToolCommands.length > 0 ? (
            <TooltipWrapper content={`${activeToolCommands.length} tool command${activeToolCommands.length !== 1 ? "s" : ""} currently running`}>
              <ViewFooterItem>
                <span className="relative flex h-2 w-2 mr-0.5">
                  <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success status-online" />
                </span>
                <span className="text-success">
                  {activeToolCommands.length} active
                </span>
              </ViewFooterItem>
            </TooltipWrapper>
          ) : (
            <TooltipWrapper content="No active tool commands">
              <ViewFooterItem>
                <Activity className="h-3 w-3" />
                <span>Ready</span>
              </ViewFooterItem>
            </TooltipWrapper>
          )}
          <ViewFooterSpacer />
          <TooltipWrapper content={`${connectedAgents} remote agent${connectedAgents !== 1 ? "s" : ""} connected`}>
            <ViewFooterItem>
              <span className="tabular-nums">{connectedAgents}</span>
              <span>agent{connectedAgents !== 1 ? "s" : ""}</span>
            </ViewFooterItem>
          </TooltipWrapper>
        </ViewFooter>
      </Tabs>
    </div>
  );
}
