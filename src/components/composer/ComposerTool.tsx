/**
 * Network Composer — unified tool for SIP/HTTP requests and SSH connections.
 *
 * Subview tabs: Requests | SSH | History | Docs
 *
 * Requests subview always uses the unified advanced workspace:
 * sidebar + toolbar + tab bar + editor area.
 */

import { lazy, Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useToolStore } from "@/stores/toolStore";
import { useComposerStore } from "@/stores/composerStore";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import { ToolHeader } from "@/components/layout/ToolHeader";
import {
  ViewFooter,
  ViewFooterItem,
  ViewFooterSpacer,
  ViewFooterDivider,
} from "@/components/layout/ViewFooter";
import {
  Send,
  SshKey,
  PanelLeft,
  Keyboard,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
const ComposerSidebar = lazy(() =>
  import("./ComposerSidebar").then((m) => ({ default: m.ComposerSidebar }))
);
const ComposerTabBar = lazy(() =>
  import("./ComposerTabBar").then((m) => ({ default: m.ComposerTabBar }))
);
const ComposerEditorArea = lazy(() =>
  import("./ComposerEditorArea").then((m) => ({ default: m.ComposerEditorArea }))
);
const SshSubview = lazy(() =>
  import("./ssh/SshSubview").then((m) => ({ default: m.SshSubview }))
);
const UnifiedHistory = lazy(() =>
  import("./history/UnifiedHistory").then((m) => ({ default: m.UnifiedHistory }))
);
const ComposerWiki = lazy(() =>
  import("./wiki/ComposerWiki").then((m) => ({ default: m.ComposerWiki }))
);
import { CREATABLE_PROTOCOLS, getProtocolMeta } from "./protocolMeta";
import { ComposerEnvironmentSelect } from "./ComposerEnvironmentSelect";

const TOOL_ID = "composer";

const SUBVIEW_REQUESTS = "requests";
const SUBVIEW_SSH = "ssh";
const SUBVIEW_HISTORY = "history";
const SUBVIEW_DOCS = "docs";

const VALID_TABS = [SUBVIEW_REQUESTS, SUBVIEW_SSH, SUBVIEW_HISTORY, SUBVIEW_DOCS] as const;

function ComposerSubviewFallback({ label }: { label: string }) {
  return (
    <div className="flex-1 min-h-0 rounded-lg border border-border/30 bg-card/40 p-3">
      <div className="text-xs text-muted-foreground mb-3">{label} loading...</div>
      <div className="h-8 skeleton mb-3" />
      <div className="h-24 skeleton mb-3" />
      <div className="h-24 skeleton" />
    </div>
  );
}

// ── Advanced view empty state ───────────────────────────────────────────────

function AdvancedEmptyState() {
  const createAndOpenItem = useComposerStore((s) => s.createAndOpenItem);
  const isMac = navigator.platform.includes("Mac");
  const mod = isMac ? "⌘" : "Ctrl";

  return (
    <div className="flex-1 flex flex-col items-center gap-7 text-center px-8 pt-[8%]">
      <div className="space-y-2">
        <p className="text-base font-semibold text-foreground/80">
          Create a request to get started
        </p>
        <p className="text-xs text-muted-foreground">
          Pick a protocol below, use {mod}+N, or click + in the tab bar.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 w-full max-w-2xl">
        {CREATABLE_PROTOCOLS.map((protocol) => {
          const meta = getProtocolMeta(protocol);
          const ProtocolIcon = meta.icon;
          return (
            <button
              key={protocol}
              type="button"
              onClick={() => createAndOpenItem(protocol)}
              className="group text-left min-h-[122px] p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card/70 to-card/40 hover:from-card hover:to-card/70 shadow-card hover:shadow-elevated transition-smooth"
            >
              <div className="flex items-center">
                <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted/40", meta.colorClass)}>
                  <ProtocolIcon className="h-5 w-5 transition-smooth" />
                </span>
              </div>
              <div className="mt-3 space-y-1">
                <p className="text-sm font-semibold text-foreground/85 group-hover:text-foreground transition-smooth">
                  {meta.requestLabel}
                </p>
                <p className="text-2xs text-muted-foreground/80 leading-relaxed">
                  {meta.blurb}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4 pt-2">
        <div className="flex items-center gap-1.5 text-2xs text-muted-foreground/60">
          <Keyboard className="h-3 w-3" />
          <span>{mod}+N new request</span>
        </div>
      </div>
    </div>
  );
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

// ── Main component ──────────────────────────────────────────────────────────

export function ComposerTool() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);

  const [activeTab, setActiveTab] = useState(SUBVIEW_REQUESTS);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newTypeDialogOpen, setNewTypeDialogOpen] = useState(false);

  useEffect(() => {
    if (activeToolId !== TOOL_ID) return;
    if (!activeSubviewId) return;

    const tab = activeSubviewId === TOOL_ID ? SUBVIEW_REQUESTS : activeSubviewId;

    if ((VALID_TABS as readonly string[]).includes(tab)) {
      setActiveTab(tab);
      setLastViewedSubview(TOOL_ID, tab);
    }
    setActiveSubview(null);
  }, [activeToolId, activeSubviewId, setActiveSubview, setLastViewedSubview]);

  useEffect(() => {
    setLastViewedSubview(TOOL_ID, activeTab);
  }, [activeTab, setLastViewedSubview]);

  // ── Resizable sidebar ──────────────────────────────────────────────────────
  const sidebarWidth = useComposerStore((s) => s.uiPrefs.sidebarWidth);
  const setUiPrefs = useComposerStore((s) => s.setUiPrefs);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const resetDragStyles = useCallback(() => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const stopDragging = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    resetDragStyles();
  }, [resetDragStyles]);

  const handleSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clamped = Math.min(400, Math.max(180, x));
      setUiPrefs({ sidebarWidth: clamped });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") stopDragging();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stopDragging);
    window.addEventListener("blur", stopDragging);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("blur", stopDragging);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopDragging();
      resetDragStyles();
    };
  }, [resetDragStyles, setUiPrefs, stopDragging]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (activeToolId !== TOOL_ID) return;
      if (isEditableKeyboardTarget(e.target)) return;

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();

      if (key === "n" && !e.shiftKey) {
        e.preventDefault();
        setNewTypeDialogOpen(true);
      }

      if (key === "b" && e.shiftKey) {
        e.preventDefault();
        setSidebarCollapsed((s) => !s);
      }

    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeToolId]);

  // ── Footer stats ───────────────────────────────────────────────────────────
  const items = useComposerStore((s) => s.collections.items);
  const requestCount = items.filter((i) => i.protocol !== "ssh").length;
  const sshCount = items.filter((i) => i.protocol === "ssh").length;
  const activeEnvId = useComposerStore((s) => s.activeEnvironmentId);
  const environments = useComposerStore((s) => s.environments);
  const activeEnvName =
    activeEnvId
      ? environments.find((e) => e.id === activeEnvId)?.name ?? "None"
      : "None";
  const historyCount = useComposerStore((s) => s.history.length);
  return (
    <div className="flex flex-col h-full min-h-0">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 min-h-0 flex flex-col gap-0"
      >
        <ToolHeader
          toolId={TOOL_ID}
          items={[
            { id: SUBVIEW_REQUESTS, label: "Requests" },
            { id: SUBVIEW_SSH, label: "SSH" },
            { id: SUBVIEW_HISTORY, label: "History" },
            { id: SUBVIEW_DOCS, label: "Docs" },
          ]}
          value={activeTab}
          onValueChange={setActiveTab}
        />

        {/* Requests — forceMount to preserve workspace/editor state */}
        <TabsContent
          value={SUBVIEW_REQUESTS}
          forceMount
          className="flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col mt-0"
        >
          <Suspense fallback={<ComposerSubviewFallback label="Requests" />}>
            <AdvancedRequestsView
              containerRef={containerRef}
              sidebarCollapsed={sidebarCollapsed}
              setSidebarCollapsed={setSidebarCollapsed}
              sidebarWidth={sidebarWidth}
              onSidebarDragStart={handleSidebarDragStart}
            />
          </Suspense>
        </TabsContent>

        {/* SSH — forceMount to preserve active connections */}
        <TabsContent
          value={SUBVIEW_SSH}
          forceMount
          className="flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col mt-0 overflow-hidden"
        >
          <Suspense fallback={<ComposerSubviewFallback label="SSH" />}>
            <SshSubview />
          </Suspense>
        </TabsContent>

        <TabsContent
          value={SUBVIEW_HISTORY}
          className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1 app-view-gutter overflow-y-auto")}
        >
          <Suspense fallback={<ComposerSubviewFallback label="History" />}>
            <UnifiedHistory />
          </Suspense>
        </TabsContent>

        <TabsContent
          value={SUBVIEW_DOCS}
          className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1 overflow-hidden")}
        >
          <Suspense fallback={<ComposerSubviewFallback label="Docs" />}>
            <ComposerWiki />
          </Suspense>
        </TabsContent>
      </Tabs>

      <ViewFooter>
        {activeTab === SUBVIEW_REQUESTS ? (
          <>
            <ViewFooterItem>
              <Send className="h-3 w-3" />
              {requestCount} request{requestCount !== 1 ? "s" : ""}
            </ViewFooterItem>
            <ViewFooterDivider />
            <ViewFooterItem>
              Env: {activeEnvName}
            </ViewFooterItem>
            <ViewFooterSpacer />
            <ViewFooterItem>
              {historyCount} history
            </ViewFooterItem>
          </>
        ) : null}

        {activeTab === SUBVIEW_SSH ? (
          <>
            <ViewFooterItem>
              <SshKey className="h-3 w-3" />
              {sshCount} SSH item{sshCount !== 1 ? "s" : ""}
            </ViewFooterItem>
            <ViewFooterDivider />
            <ViewFooterItem>
              Env: {activeEnvName}
            </ViewFooterItem>
            <ViewFooterSpacer />
          </>
        ) : null}

        {activeTab === SUBVIEW_HISTORY ? (
          <>
            <ViewFooterItem>
              <PanelLeft className="h-3 w-3" />
              {historyCount} history item{historyCount !== 1 ? "s" : ""}
            </ViewFooterItem>
            <ViewFooterSpacer />
            <ViewFooterItem>
              <Send className="h-3 w-3" />
              {requestCount} request{requestCount !== 1 ? "s" : ""}
            </ViewFooterItem>
          </>
        ) : null}

        {activeTab === SUBVIEW_DOCS ? (
          <>
            <ViewFooterItem>
              <Keyboard className="h-3 w-3" />
              <span>Composer docs</span>
            </ViewFooterItem>
            <ViewFooterSpacer />
            <ViewFooterItem>
              Env: {activeEnvName}
            </ViewFooterItem>
          </>
        ) : null}
      </ViewFooter>

      <NewComposerTypeDialog
        open={newTypeDialogOpen}
        onOpenChange={setNewTypeDialogOpen}
        onCreate={(protocol) => {
          useComposerStore.getState().createAndOpenItem(protocol);
          if (protocol === "ssh") setActiveTab(SUBVIEW_SSH);
          else setActiveTab(SUBVIEW_REQUESTS);
        }}
      />
    </div>
  );
}

function NewComposerTypeDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (protocol: "sip" | "http" | "websocket" | "graphql" | "ssh") => void;
}) {
  const createOptions: Array<"sip" | "http" | "websocket" | "graphql" | "ssh"> = [
    "sip",
    "http",
    "websocket",
    "graphql",
    "ssh",
  ];
  const firstRow = createOptions.slice(0, 3);
  const secondRow = createOptions.slice(3);

  const renderProtocolButton = (protocol: "sip" | "http" | "websocket" | "graphql" | "ssh") => {
    const meta = getProtocolMeta(protocol);
    const Icon = meta.icon;
    return (
      <button
        key={protocol}
        type="button"
        onClick={() => {
          onCreate(protocol);
          onOpenChange(false);
        }}
        className="group rounded-xl border border-border/40 bg-gradient-to-b from-card/70 to-card/40 hover:from-card hover:to-card/70 shadow-card hover:shadow-elevated p-3 text-left transition-smooth"
      >
        <div className="flex items-center gap-2.5">
          <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40", meta.colorClass)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground/85 group-hover:text-foreground transition-smooth truncate">
              {meta.label}
            </p>
            <p className="text-2xs text-muted-foreground/80 truncate">{meta.requestLabel}</p>
          </div>
        </div>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5">
        <DialogHeader>
          <DialogTitle className="text-base">Create in Composer</DialogTitle>
          <DialogDescription>
            Choose what you want to create.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <div className="grid grid-cols-3 gap-2.5">
            {firstRow.map(renderProtocolButton)}
          </div>
          <div className="grid grid-cols-2 gap-2.5 mx-auto w-[66.666%]">
            {secondRow.map(renderProtocolButton)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Advanced Requests View (Postman-style IDE) ──────────────────────────────

function AdvancedRequestsView({
  containerRef,
  sidebarCollapsed,
  setSidebarCollapsed,
  sidebarWidth,
  onSidebarDragStart,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  sidebarWidth: number;
  onSidebarDragStart: (e: React.MouseEvent) => void;
}) {
  const activeTabId = useComposerStore((s) => s.activeTabId);
  const openTabs = useComposerStore((s) => s.openTabs);
  const allItems = useComposerStore((s) => s.collections.items);
  const hasVisibleTabs = openTabs.some((t) => {
    const item = allItems.find((i) => i.id === t.itemId);
    return item && item.protocol !== "ssh";
  });

  const isMac = navigator.platform.includes("Mac");
  const mod = isMac ? "⌘" : "Ctrl";

  return (
    <div ref={containerRef} className="flex-1 min-h-0 flex flex-row overflow-hidden">
      {/* ── Sidebar ──────────────────────────────────────────── */}
      {!sidebarCollapsed && (
        <>
          <div
            className="flex flex-col min-h-0 overflow-hidden shrink-0 border-r border-border/30"
            style={{ width: sidebarWidth }}
          >
            <Suspense fallback={<ComposerSubviewFallback label="Sidebar" />}>
              <ComposerSidebar />
            </Suspense>
          </div>
          <div
            className="shrink-0 w-1 cursor-col-resize group hover:bg-primary/10 active:bg-primary/15 transition-smooth select-none"
            onMouseDown={onSidebarDragStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
          />
        </>
      )}

      {/* ── Main editor panel ────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
        {/* ── Toolbar ─────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/30 bg-muted/10 shrink-0">
          {/* Sidebar toggle */}
          <TooltipWrapper content={`${sidebarCollapsed ? "Show" : "Hide"} sidebar (${mod}+Shift+B)`}>
            <button
              type="button"
              aria-label={sidebarCollapsed ? "Show composer sidebar" : "Hide composer sidebar"}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-lg transition-smooth",
                sidebarCollapsed
                  ? "text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
                  : "text-foreground/70 bg-muted/30 hover:bg-muted/50"
              )}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          </TooltipWrapper>

          <div className="w-px h-4 bg-border/30 mx-0.5" />

          <div className="flex-1" />

          {/* Environment selector (compact) */}
          <ComposerEnvironmentSelect className="w-[180px] shrink-0" />

        </div>

        {/* ── Tab bar ─────────────────────────────────────────── */}
        <Suspense fallback={<div className="min-h-[2.2rem] border-b border-border/30 bg-muted/20 skeleton" />}>
          <ComposerTabBar />
        </Suspense>

        {/* ── Editor or empty state ───────────────────────────── */}
        {hasVisibleTabs && activeTabId ? (
          <Suspense fallback={<ComposerSubviewFallback label="Editor" />}>
            <ComposerEditorArea />
          </Suspense>
        ) : (
          <AdvancedEmptyState />
        )}
      </div>
    </div>
  );
}
