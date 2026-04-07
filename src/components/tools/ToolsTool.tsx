import { useEffect, useState, useMemo } from "react";
import { useToolStore } from "@/stores/toolStore";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import { cn } from "@/lib/utils";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAG_MCP_UI, FEATURE_FLAG_TOOLS_MOCKUP_UI } from "@/lib/featureFlags";
import { shouldDeferToolsSubviewHydration } from "@/components/tools/toolsSubviewHydration";

import { SyslogView } from "@/components/tools/syslog/SyslogView";
import { LogViewerView } from "@/components/tools/log-viewer/LogViewerView";
import { FileServerView } from "@/components/tools/file-server/FileServerView";
import { PasswordGeneratorView } from "@/components/tools/password-gen/PasswordGeneratorView";
import { McpView } from "@/components/tools/mcp/McpView";
import { MockupPlaygroundView } from "@/components/tools/mockup/MockupPlaygroundView";
import { TextForgeView } from "@/components/tools/text-forge/TextForgeView";

const SUBVIEW_SYSLOG = "syslog";
const SUBVIEW_LOGS = "logs";
const SUBVIEW_FILE_SERVER = "file-server";
const SUBVIEW_PASSWORD_GEN = "password-gen";
const SUBVIEW_TEXT_FORGE = "text-forge";
const SUBVIEW_MOCKUP = "mockup";
const SUBVIEW_MCP = "mcp";

const TOOL_ID = "tools";

const EXEC_CONTEXT_MAP: Record<string, string> = {
  [SUBVIEW_SYSLOG]: "toolsSyslog",
  [SUBVIEW_LOGS]: "toolsLogs",
  [SUBVIEW_FILE_SERVER]: "toolsFileServer",
  [SUBVIEW_MCP]: "toolsMcp",
};

export function ToolsTool() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);
  const [activeTab, setActiveTab] = useState<string>(SUBVIEW_SYSLOG);
  const { enabled: mcpEnabled, loading: mcpLoading } = useFeatureFlag(FEATURE_FLAG_MCP_UI);
  const { enabled: mockupEnabled, loading: mockupLoading } = useFeatureFlag(FEATURE_FLAG_TOOLS_MOCKUP_UI);

  const execContextToolId = useMemo(
    () => EXEC_CONTEXT_MAP[activeTab],
    [activeTab],
  );
  const validTabs = useMemo(() => {
    const tabs = [
      SUBVIEW_SYSLOG,
      SUBVIEW_LOGS,
      SUBVIEW_FILE_SERVER,
      SUBVIEW_PASSWORD_GEN,
      SUBVIEW_TEXT_FORGE,
    ];
    if (mockupEnabled) tabs.push(SUBVIEW_MOCKUP);
    if (mcpEnabled) tabs.push(SUBVIEW_MCP);
    return tabs;
  }, [mcpEnabled, mockupEnabled]);
  const tabItems = useMemo(() => {
    const items = [
      { id: SUBVIEW_SYSLOG, label: "Syslog" },
      { id: SUBVIEW_LOGS, label: "Log Viewer" },
      { id: SUBVIEW_FILE_SERVER, label: "File Server" },
      { id: SUBVIEW_PASSWORD_GEN, label: "Password Generator" },
      { id: SUBVIEW_TEXT_FORGE, label: "Text Forge" },
    ];
    if (mockupEnabled) items.push({ id: SUBVIEW_MOCKUP, label: "Mockup" });
    if (mcpEnabled) items.push({ id: SUBVIEW_MCP, label: "MCP" });
    return items;
  }, [mcpEnabled, mockupEnabled]);

  useEffect(() => {
    if (activeToolId !== TOOL_ID) return;
    if (!activeSubviewId) return;
    if (validTabs.includes(activeSubviewId)) {
      setActiveTab(activeSubviewId);
      setLastViewedSubview(TOOL_ID, activeSubviewId);
      setActiveSubview(null);
      return;
    }
    if (
      shouldDeferToolsSubviewHydration(activeSubviewId, {
        mcpEnabled,
        mcpLoading,
        mockupEnabled,
        mockupLoading,
      })
    ) {
      return;
    }
    setActiveSubview(null);
  }, [
    activeToolId,
    activeSubviewId,
    mcpEnabled,
    mcpLoading,
    mockupEnabled,
    mockupLoading,
    setActiveSubview,
    setLastViewedSubview,
    validTabs,
  ]);

  useEffect(() => {
    setLastViewedSubview(TOOL_ID, activeTab);
  }, [activeTab, setLastViewedSubview]);

  useEffect(() => {
    if (!mcpEnabled && activeTab === SUBVIEW_MCP) {
      setActiveTab(SUBVIEW_SYSLOG);
      setLastViewedSubview(TOOL_ID, SUBVIEW_SYSLOG);
    }
  }, [mcpEnabled, activeTab, setLastViewedSubview]);

  useEffect(() => {
    if (!mockupEnabled && activeTab === SUBVIEW_MOCKUP) {
      setActiveTab(SUBVIEW_SYSLOG);
      setLastViewedSubview(TOOL_ID, SUBVIEW_SYSLOG);
    }
  }, [mockupEnabled, activeTab, setLastViewedSubview]);

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
              <FileServerView
                toolId={TOOL_ID}
                registerHeaderBreadcrumbTabs={activeTab === SUBVIEW_FILE_SERVER}
              />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_PASSWORD_GEN} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <PasswordGeneratorView />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_TEXT_FORGE} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <TextForgeView />
            </div>
          </TabsContent>
          {mockupEnabled ? (
            <TabsContent value={SUBVIEW_MOCKUP} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
              <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
                <MockupPlaygroundView />
              </div>
            </TabsContent>
          ) : null}
          {mcpEnabled ? (
            <TabsContent value={SUBVIEW_MCP} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
              <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
                <McpView />
              </div>
            </TabsContent>
          ) : null}
        </div>

      </Tabs>
    </div>
  );
}
