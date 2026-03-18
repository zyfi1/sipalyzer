import { useState } from "react";
import { useToolStore } from "@/stores/toolStore";
import { useSidebarStore } from "@/stores/sidebarStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useBreadcrumbStore } from "@/stores/breadcrumbStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { toolRegistry, HOME_TOOL_ID, type ToolDefinition } from "@/lib/toolRegistry";
import { navigateTo } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Terminal } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { liveRingClass } from "@/components/ui/live-indicator";
import { preloadToolById } from "@/lib/preloadTools";
import { isProvisionViewerSubviewAvailable } from "@/lib/provisionNav";
import { FEATURE_FLAG_MCP_UI } from "@/lib/featureFlags";
import { isFeatureFlagEnabled } from "@/lib/featureFlagCache";

/** Tool IDs that are rendered in their own dedicated sidebar section (not in the main nav list). */
const BOTTOM_TOOL_IDS = new Set(["remote-agent", "composer", "tools"]);

/** Nav selection — subtle neutral active state with primary accent bar */
const NAV_ACTIVE_CLASS = "bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))] border border-border/50 relative before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-0.5 before:h-[60%] before:rounded-[1px] before:bg-primary";

/** Tertiary selection — intentionally distinct from parent/nav selection. */
const TERTIARY_ACTIVE_CLASS = "bg-accent/65 text-foreground border border-border/40 relative before:absolute before:left-1.5 before:top-1/2 before:-translate-y-1/2 before:h-1.5 before:w-1.5 before:rounded-[var(--radius-sm)] before:bg-primary";

/** Active style with pulsing outline — used for Packet Monitor and Terminal only. */
const PULSE_ACTIVE_CLASS = "bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))] border border-border/50 animate-nav-active-pulse";
const SHOW_TERTIARY_SUBVIEWS = true;

export function Sidebar() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const lastViewedSubviews = useToolStore((s) => s.lastViewedSubviews);
  const provisionResultLoaded = useToolStore((s) => Boolean(s.provisionViewerData.result));
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const allTools = toolRegistry.getAll();
  const tools = allTools.filter((t) => !BOTTOM_TOOL_IDS.has(t.id) && !t.hidden);
  const bottomTools = allTools.filter((t) => BOTTOM_TOOL_IDS.has(t.id) && !t.hidden);

  const terminalOpen = useLayoutStore((s) => s.terminalOpen);
  const terminalMinimized = useLayoutStore((s) => s.terminalMinimized);
  const setTerminalOpen = useLayoutStore((s) => s.setTerminalOpen);
  const setTerminalMinimized = useLayoutStore((s) => s.setTerminalMinimized);

  const handleTerminalClick = () => {
    if (terminalMinimized) {
      setTerminalMinimized(false);
    } else if (terminalOpen) {
      setTerminalMinimized(true);
    } else {
      setTerminalOpen(true);
    }
  };

  const previousToolId = useToolStore((s) => s.previousToolId);
  const packetMonitorActive = usePacketCaptureStore((s) => s.packetMonitorActive);
  const activeToolSegments = useBreadcrumbStore((s) =>
    activeToolId ? s.segments[activeToolId] : undefined,
  );
  const tertiarySegment = activeToolSegments?.[1];
  const [expandedTertiaryKey, setExpandedTertiaryKey] = useState<string | null>(null);

  const resolveSubview = (tool: ToolDefinition, requestedSubview?: string | null) => {
    const subviews = visibleSubviews(tool);
    if (!subviews.length) return null;
    if (requestedSubview && subviews.some((s) => s.id === requestedSubview)) {
      return requestedSubview;
    }
    return subviews[0]?.id ?? null;
  };

  const handleToolClick = (toolId: string, subviewId?: string) => {
    const tool = toolRegistry.get(toolId);
    if (!tool) return;
    preloadToolById(toolId).catch(() => {});
    const resolvedSubview =
      resolveSubview(tool, subviewId ?? lastViewedSubviews[toolId] ?? null);
    navigateTo(toolId, resolvedSubview);
  };

  /** Bottom tools toggle on re-click — go back to previous tool. */
  const handleBottomToolClick = (toolId: string) => {
    preloadToolById(toolId).catch(() => {});
    if (activeToolId === toolId) {
      // Toggle off — go back to previous tool or home
      const previousId = previousToolId ?? HOME_TOOL_ID;
      const previousTool = toolRegistry.get(previousId);
      if (!previousTool) return;
      const previousSubview =
        resolveSubview(previousTool, lastViewedSubviews[previousId] ?? null);
      navigateTo(previousId, previousSubview);
    } else {
      const tool = toolRegistry.get(toolId);
      if (!tool) return;
      const subviewId = resolveSubview(tool, lastViewedSubviews[toolId] ?? null);
      navigateTo(toolId, subviewId);
    }
  };

  const toggleTertiary = (key: string) => {
    setExpandedTertiaryKey((prev) => (prev === key ? null : key));
  };

  const visibleSubviews = (tool: ToolDefinition) => {
    const subviews = tool.subviews ?? [];
    if (tool.id === "tools" && !isFeatureFlagEnabled(FEATURE_FLAG_MCP_UI, false)) {
      return subviews.filter((sub) => sub.id !== "mcp");
    }
    if (tool.id !== "provision-viewer") return subviews;
    return subviews.filter((sub) => isProvisionViewerSubviewAvailable(sub.id, provisionResultLoaded));
  };

  const prefetchTool = (toolId: string) => {
    preloadToolById(toolId).catch(() => {});
  };

  const renderSubviews = (tool: ToolDefinition, isActive: boolean, currentSubview?: string) => {
    if (!tool.subviews?.length) return null;
    return (
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
          isActive ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-5">
            <span className="absolute left-0 top-4 bottom-4 w-px bg-border" />
            <div className="space-y-0.5">
              {visibleSubviews(tool)
                .map((sub) => {
                const subKey = `${tool.id}:${sub.id}`;
                const subIsActive = currentSubview === sub.id;
                const hasTertiary =
                  SHOW_TERTIARY_SUBVIEWS &&
                  isActive &&
                  subIsActive &&
                  !!tertiarySegment &&
                  tertiarySegment.items.length > 0;
                const tertiaryOpen = expandedTertiaryKey === subKey;
                return (
                  <div key={sub.id} className="relative">
                    {hasTertiary && tertiaryOpen && (
                      <span className="absolute left-3 top-4 bottom-0 w-px bg-border" />
                    )}
                    <span className="absolute left-0 top-4 w-[13px] h-px bg-border" />
                    <div
                      className={cn(
                        "ml-3 h-8 rounded-[var(--radius-md)] px-2.5 flex items-center gap-1.5 transition-smooth",
                        subIsActive
                          ? NAV_ACTIVE_CLASS
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <button
                        onClick={() => handleToolClick(tool.id, sub.id)}
                        onMouseEnter={() => prefetchTool(tool.id)}
                        onPointerDown={() => prefetchTool(tool.id)}
                        className="flex-1 h-full text-left text-sm flex items-center"
                      >
                        <span className="truncate block leading-none">{sub.label}</span>
                      </button>
                      {hasTertiary && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleTertiary(subKey);
                          }}
                          className={cn(
                            "h-6 w-6 shrink-0 rounded-[var(--radius-sm)] flex items-center justify-center transition-smooth",
                            subIsActive
                              ? "text-[hsl(var(--sidebar-primary-foreground))/0.92] hover:bg-white/10"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                          aria-label={tertiaryOpen ? "Collapse nested subviews" : "Expand nested subviews"}
                        >
                          {tertiaryOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>

                    {hasTertiary && (
                      <div
                        className={cn(
                          "grid transition-[grid-template-rows,opacity] duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
                          tertiaryOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                        )}
                      >
                        <div className="overflow-hidden">
                          <div className="relative mt-0 ml-3">
                            <span className="absolute left-0 top-0 bottom-4 w-px bg-border" />
                            <div className="space-y-0">
                              {tertiarySegment!.items.map((item) => {
                                const tertiaryActive = tertiarySegment!.value === item.id;
                                return (
                                  <div key={`${subKey}:${item.id}`} className="relative">
                                    <span className="absolute left-0 top-4 w-4 h-px bg-border" />
                                    <button
                                      type="button"
                                      onClick={() => tertiarySegment!.onChange(item.id)}
                                      className={cn(
                                        "ml-2 w-[calc(100%-18px)] h-8 pl-6 pr-2 text-left text-xs rounded-[var(--radius-sm)] transition-smooth flex items-center gap-1.5",
                                        tertiaryActive
                                          ? TERTIARY_ACTIVE_CLASS
                                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                                      )}
                                    >
                                      <span className="truncate block leading-none pl-1">{item.label}</span>
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        "app-sidebar flex flex-col transition-smooth relative flex-shrink-0 h-full min-h-0",
        isCollapsed ? "w-16" : "w-56"
      )}
    >
      {/* Navigation */}
      <nav
        className={cn(
          "flex-shrink transition-smooth overflow-y-auto min-h-0 space-y-1.5",
          isCollapsed ? "p-3" : "px-4 py-3"
        )}
      >
        {tools.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeToolId === tool.id;
          const hasSubviews = Boolean(tool.subviews?.length);
          const currentSubview = visibleSubviews(tool).some(
            (sub) => sub.id === lastViewedSubviews[tool.id],
          )
            ? lastViewedSubviews[tool.id]
            : visibleSubviews(tool)[0]?.id;
          const isCapturing = tool.id === "packet-capture" && packetMonitorActive;

          // Collapsed sidebar: icon-only buttons
          if (isCollapsed) {
            const button = (
              <button
                onClick={() => handleToolClick(tool.id)}
                onMouseEnter={() => prefetchTool(tool.id)}
                onPointerDown={() => prefetchTool(tool.id)}
                className={cn(
                  "w-full flex items-center justify-center rounded-[var(--radius-md)] transition-smooth",
                  "p-2.5",
                  isActive
                    ? (isCapturing ? PULSE_ACTIVE_CLASS : NAV_ACTIVE_CLASS)
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  isCapturing && !isActive && liveRingClass,
                )}
              >
                <Icon className="h-5 w-5" />
              </button>
            );
            return (
              <TooltipWrapper key={tool.id} content={tool.name} side="right">
                {button}
              </TooltipWrapper>
            );
          }

          // Expanded sidebar: tool with auto-expanded subviews when active
          return (
            <div key={tool.id}>
              {/* Main tool button */}
              <button
                onClick={() => handleToolClick(tool.id)}
                onMouseEnter={() => prefetchTool(tool.id)}
                onPointerDown={() => prefetchTool(tool.id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-[var(--radius-md)] text-sm font-medium transition-smooth text-left",
                  "px-3 py-2",
                  isActive
                    ? (isCapturing ? PULSE_ACTIVE_CLASS : NAV_ACTIVE_CLASS)
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  isCapturing && !isActive && liveRingClass,
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{tool.name}</span>
              </button>

              {/* Subviews container with grid animation */}
              {hasSubviews && renderSubviews(tool, isActive, currentSubview)}
            </div>
          );
        })}
      </nav>

      {/* Spacer — pushes bottom tools to midpoint between nav and terminal */}
      <div className="flex-1 min-h-4" />

      {/* Bottom tools — centered between main nav and terminal */}
      {bottomTools.length > 0 && (
        <div
          className={cn(
            "flex-shrink-0 space-y-1.5",
            isCollapsed ? "p-3" : "px-4 py-1.5"
          )}
        >
          <div className={cn("mb-2", isCollapsed ? "mx-1" : "mx-0.5", "h-px bg-border/30")} />
          {bottomTools.map((tool) => {
            const Icon = tool.icon;
            const isActive = activeToolId === tool.id;
            const hasSubviews = Boolean(tool.subviews?.length);
            const currentSubview = visibleSubviews(tool).some(
              (sub) => sub.id === lastViewedSubviews[tool.id],
            )
              ? lastViewedSubviews[tool.id]
              : visibleSubviews(tool)[0]?.id;

            if (isCollapsed) {
              return (
                <TooltipWrapper key={tool.id} content={tool.name} side="right">
                  <button
                    onClick={() => handleBottomToolClick(tool.id)}
                    onMouseEnter={() => prefetchTool(tool.id)}
                    onPointerDown={() => prefetchTool(tool.id)}
                    className={cn(
                      "w-full flex items-center justify-center rounded-[var(--radius-md)] transition-smooth p-2.5",
                      isActive
                        ? NAV_ACTIVE_CLASS
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                </TooltipWrapper>
              );
            }

            return (
              <div key={tool.id}>
                <button
                  onClick={() => handleBottomToolClick(tool.id)}
                  onMouseEnter={() => prefetchTool(tool.id)}
                  onPointerDown={() => prefetchTool(tool.id)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-[var(--radius-md)] text-sm font-medium transition-smooth text-left",
                    "px-3 py-2",
                    isActive
                      ? NAV_ACTIVE_CLASS
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{tool.name}</span>
                </button>

                {/* Subviews */}
                {hasSubviews && renderSubviews(tool, isActive, currentSubview)}
              </div>
            );
          })}
          <div className={cn("mt-2", isCollapsed ? "mx-1" : "mx-0.5", "h-px bg-border/30")} />
        </div>
      )}

      {/* Spacer — pushes terminal to bottom */}
      <div className="flex-1 min-h-4" />

      {/* Terminal button */}
      <div
        className={cn(
          "flex-shrink-0 shadow-[inset_0_1px_0_0_hsl(0_0%_0%/0.2)]",
          isCollapsed ? "p-3" : "px-4 py-3"
        )}
      >
        {isCollapsed ? (
          <TooltipWrapper
            title="Terminal"
            description={terminalMinimized ? "Restore terminal" : terminalOpen ? "Minimize terminal" : "Open a terminal session"}
            side="right"
          >
            <button
              onClick={handleTerminalClick}
              data-terminal-btn
              className={cn(
                "w-full flex items-center justify-center rounded-[var(--radius-md)] transition-smooth p-2.5",
                terminalMinimized
                  ? liveRingClass
                  : terminalOpen
                    ? PULSE_ACTIVE_CLASS
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Terminal className="h-5 w-5" />
            </button>
          </TooltipWrapper>
        ) : (
          <TooltipWrapper
            title="Terminal"
            description={terminalMinimized ? "Restore terminal" : terminalOpen ? "Minimize terminal" : "Open a terminal session"}
            side="right"
          >
            <button
              onClick={handleTerminalClick}
              data-terminal-btn
              className={cn(
                "w-full flex items-center gap-3 rounded-[var(--radius-md)] text-sm font-medium transition-smooth text-left px-3 py-2",
                terminalMinimized
                  ? liveRingClass
                  : terminalOpen
                    ? PULSE_ACTIVE_CLASS
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Terminal className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">Terminal</span>
              {terminalMinimized && (
                <span className="ml-auto flex-shrink-0 h-2 w-2 rounded-full bg-primary animate-live-breathe" />
              )}
            </button>
          </TooltipWrapper>
        )}

      </div>

    </div>
  );
}
