/**
 * FloatingTerminal — draggable, resizable floating window for the terminal.
 *
 * Resize cursor & click detection uses native document-level listeners in
 * capture phase. This fires before ANY element (including xterm.js) can
 * interfere. The listener checks if the pointer is within GRAB px of the
 * window edges using getBoundingClientRect.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { TerminalEmulator, type TerminalEmulatorHandle, type TerminalMode } from "./TerminalEmulator";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { TabContextMenu } from "./TabContextMenu";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { cn } from "@/lib/utils";
import { Terminal, Minus, MaximizeScreen, MinimizeScreen, X, Plus, Globe, ChevronDown } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ── Constants ──────────────────────────────────────────────────── */
const DEFAULT_W = 960;
const DEFAULT_H = 560;
const MIN_W = 420;
const MIN_H = 220;
const APP_HEADER_H = 48;
const TITLE_BAR_H = 36;
const TAB_BAR_H = 32;
const GRAB = 14;

let nextTabId = 1;
interface TermTab { id: number; label: string; mode: TerminalMode; }

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null;

/* ── Custom SVG double-arrow cursors ─────────────────────────────
 * Creates a bold double-headed arrow rotated by `deg` degrees.
 * Returns a full CSS cursor value with the SVG data URI + standard fallback. */
function arrowCursor(deg: number, fallback: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><g transform="rotate(${deg} 12 12)"><path d="M12 2L6 9h4v6H6l6 7 6-7h-4V9h4z" fill="black" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></g></svg>`;
  return `url('data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}') 12 12, ${fallback}`;
}

const EDGE_CURSOR: Record<string, string> = {
  n:  arrowCursor(0, "ns-resize"),
  s:  arrowCursor(0, "ns-resize"),
  e:  arrowCursor(90, "ew-resize"),
  w:  arrowCursor(90, "ew-resize"),
  nw: arrowCursor(-45, "nwse-resize"),
  se: arrowCursor(-45, "nwse-resize"),
  ne: arrowCursor(45, "nesw-resize"),
  sw: arrowCursor(45, "nesw-resize"),
};

interface FloatingTerminalProps {
  isOpen: boolean;
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
  onClose: () => void;
}

/* ── Helpers ────────────────────────────────────────────────────── */
function clamp(v: number, min: number) { return Math.max(min, v); }

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function getTerminalBtnCenter(): { x: number; y: number } | null {
  const el = document.querySelector("[data-terminal-btn]");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function hitTestEdge(px: number, py: number, w: number, h: number): Edge {
  const nearL = px < GRAB;
  const nearR = px > w - GRAB;
  const nearT = py < GRAB;
  const nearB = py > h - GRAB;
  if (nearT && nearL) return "nw";
  if (nearT && nearR) return "ne";
  if (nearB && nearL) return "sw";
  if (nearB && nearR) return "se";
  if (nearT) return "n";
  if (nearB) return "s";
  if (nearL) return "w";
  if (nearR) return "e";
  return null;
}

/** Force cursor globally by injecting a <style> tag that overrides everything. */
function forceCursor(cursor: string | null) {
  const ID = "_ft_resize_cursor";
  let el = document.getElementById(ID);
  if (cursor) {
    if (!el) {
      el = document.createElement("style");
      el.id = ID;
      document.head.appendChild(el);
    }
    el.textContent = `*, *::before, *::after { cursor: ${cursor} !important; }`;
  } else if (el) {
    el.remove();
  }
}

/* ── Agent Tab Picker ────────────────────────────────────────────
 * Dropdown next to the "+" button that lists connected agents
 * with "Shell" capability for opening remote shell tabs. */
function AgentTabPicker({ onSelectAgent }: { onSelectAgent: (agentId: string, label: string) => void }) {
  const connections = useRemoteAgentStore((s) => s.connections);
  const shellAgents = connections.filter(
    (c) => c.status === "connected" && c.capabilities.includes("Shell")
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center justify-center h-full px-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-smooth border-l border-border/30"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="z-[10002] min-w-[180px]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Remote Shell</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {shellAgents.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground/60">
            No agents connected
          </div>
        ) : (
          shellAgents.map((agent) => {
            const label = agent.name || agent.hostname || agent.id.slice(0, 8);
            return (
              <DropdownMenuItem
                key={agent.id}
                onClick={() => onSelectAgent(agent.id, label)}
                className="flex items-center gap-2 text-xs"
              >
                <Globe className="h-3.5 w-3.5 text-primary/80" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium">{label}</span>
                  <span className="text-2xs text-muted-foreground truncate">
                    {agent.os} &middot; {agent.ip}
                  </span>
                </div>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Component ──────────────────────────────────────────────────── */
export function FloatingTerminal({
  isOpen,
  minimized,
  onMinimizedChange,
  onClose,
}: FloatingTerminalProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  /* ── Tab state ──────────────────────────────────────────────── */
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const initializedForOpenRef = useRef(false);
  const tabsRef = useRef<TermTab[]>([]);
  const activeTabIdRef = useRef<number | null>(null);
  const termRefs = useRef<Map<number, TerminalEmulatorHandle>>(new Map());
  const pendingSshAuthByTabRef = useRef<Map<number, { password: string; sentPassword: boolean; sentHostConfirm: boolean }>>(new Map());
  const pendingSshConnectByTabRef = useRef<Map<number, { command: string; passwordPromptNotified: boolean; tunnelReadyTimerId?: number; connectionId?: string; isTunnelOnly?: boolean }>>(new Map());
  const outputBufferByTabRef = useRef<Map<number, string>>(new Map());
  const handledSshExecuteIdsRef = useRef<Set<string>>(new Set());

  /** Get the handle for the active tab */
  const activeTermRef = useCallback(() => {
    if (activeTabId == null) return null;
    return termRefs.current.get(activeTabId) ?? null;
  }, [activeTabId]);

  /** Ref callback passed to each TerminalEmulator via a wrapper */
  const setTermRef = useCallback((tabId: number, handle: TerminalEmulatorHandle | null) => {
    if (handle) termRefs.current.set(tabId, handle);
    else termRefs.current.delete(tabId);
  }, []);

  const addTab = useCallback(() => {
    initializedForOpenRef.current = true;
    const id = nextTabId++;
    const label = `Terminal ${id}`;
    setTabs((prev) => [...prev, { id, label, mode: { type: "local" } }]);
    setActiveTabId(id);
  }, []);

  const addRemoteTab = useCallback((agentId: string, agentLabel: string) => {
    initializedForOpenRef.current = true;
    const id = nextTabId++;
    setTabs((prev) => [...prev, { id, label: agentLabel, mode: { type: "remote", agentId } }]);
    setActiveTabId(id);
    // Log the shell session in the activity log
    useRemoteAgentStore.getState().addLogEntry({
      agentId,
      agentHostname: agentLabel,
      type: "command_sent",
      message: `Opened remote shell on ${agentLabel}`,
    });
  }, []);

  const pendingCloseRef = useRef(false);

  const closeTab = useCallback((tabId: number) => {
    termRefs.current.delete(tabId);
    pendingSshAuthByTabRef.current.delete(tabId);
    const pendingConnect = pendingSshConnectByTabRef.current.get(tabId);
    if (pendingConnect?.tunnelReadyTimerId) {
      window.clearTimeout(pendingConnect.tunnelReadyTimerId);
    }
    pendingSshConnectByTabRef.current.delete(tabId);
    outputBufferByTabRef.current.delete(tabId);

    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);

      if (next.length === 0) {
        // Last tab — schedule terminal close
        pendingCloseRef.current = true;
        setTimeout(() => {
          if (pendingCloseRef.current) {
            pendingCloseRef.current = false;
            onClose();
          }
        }, 0);
        return next;
      }

      // If we're closing the active tab, switch to an adjacent one
      setActiveTabId((prevActive) => {
        if (prevActive !== tabId) return prevActive;
        const idx = prev.findIndex((t) => t.id === tabId);
        const neighbor = prev[idx + 1] ?? prev[idx - 1];
        return neighbor?.id ?? next[0]?.id ?? null;
      });

      return next;
    });
  }, [onClose]);

  const renameTab = useCallback((tabId: number, newLabel: string) => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, label: trimmed } : t)));
  }, []);

  const closeOtherTabs = useCallback((keepTabId: number) => {
    setTabs((prev) => {
      for (const t of prev) {
        if (t.id !== keepTabId) {
          termRefs.current.delete(t.id);
          pendingSshAuthByTabRef.current.delete(t.id);
          const pendingConnect = pendingSshConnectByTabRef.current.get(t.id);
          if (pendingConnect?.tunnelReadyTimerId) {
            window.clearTimeout(pendingConnect.tunnelReadyTimerId);
          }
          pendingSshConnectByTabRef.current.delete(t.id);
          outputBufferByTabRef.current.delete(t.id);
        }
      }
      return prev.filter((t) => t.id === keepTabId);
    });
    setActiveTabId(keepTabId);
  }, []);

  const closeTabsToRight = useCallback((tabId: number) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx < 0) return prev;
      const toRemove = prev.slice(idx + 1);
      for (const t of toRemove) {
        termRefs.current.delete(t.id);
        pendingSshAuthByTabRef.current.delete(t.id);
        const pendingConnect = pendingSshConnectByTabRef.current.get(t.id);
        if (pendingConnect?.tunnelReadyTimerId) {
          window.clearTimeout(pendingConnect.tunnelReadyTimerId);
        }
        pendingSshConnectByTabRef.current.delete(t.id);
        outputBufferByTabRef.current.delete(t.id);
      }
      const next = prev.slice(0, idx + 1);
      setActiveTabId((prevActive) => {
        if (next.find((t) => t.id === prevActive)) return prevActive;
        return tabId;
      });
      return next;
    });
  }, []);

  const [editingTabId, setEditingTabId] = useState<number | null>(null);
  const [tabCtxMenu, setTabCtxMenu] = useState<{ open: boolean; x: number; y: number; tabId: number | null }>({
    open: false, x: 0, y: 0, tabId: null,
  });

  // Reset open-cycle initializer guard when terminal fully closes.
  useEffect(() => {
    if (!isOpen) initializedForOpenRef.current = false;
  }, [isOpen]);

  // Ensure exactly one initial tab exists per open cycle.
  // Functional updater keeps this StrictMode-safe and idempotent.
  useEffect(() => {
    if (!isOpen) return;
    if (initializedForOpenRef.current) return;

    setTabs((prev) => {
      if (prev.length > 0) {
        initializedForOpenRef.current = true;
        return prev;
      }
      initializedForOpenRef.current = true;
      const id = nextTabId++;
      // Safe here: this only runs on first-tab creation path.
      setActiveTabId(id);
      return [{ id, label: `Terminal ${id}`, mode: { type: "local" } }];
    });
  }, [isOpen]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  /* ── SSH execute listener ─────────────────────────────────────
   * When the SSH Helper dispatches a command, open a new tab and
   * write the command into the PTY after a short initialization delay. */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ command: string; password?: string; requestId?: string; connectionId?: string }>).detail;
      const command = detail?.command;
      const password = detail?.password;
      const requestId = detail?.requestId;
      const connectionId = detail?.connectionId;
      if (!command) return;
      // SSH execution itself counts as initialization for this open cycle.
      initializedForOpenRef.current = true;
      if (requestId) {
        window.dispatchEvent(
          new CustomEvent("ssh:execute:ack", { detail: { requestId } }),
        );
        if (handledSshExecuteIdsRef.current.has(requestId)) return;
        handledSshExecuteIdsRef.current.add(requestId);
      }

      // Reuse an existing SSH tab when possible to avoid
      // spawning extra terminal tabs per connection attempt.
      let targetId: number | null = null;
      setTabs((prev) => {
        const existingSsh = prev.find((tab) => tab.label === "SSH");
        if (existingSsh) {
          targetId = existingSsh.id;
          return prev;
        }

        const activeId = activeTabIdRef.current;
        const activeTab = activeId ? prev.find((tab) => tab.id === activeId) : null;
        if (activeTab && activeTab.mode.type === "local") {
          targetId = activeTab.id;
          return prev.map((tab) => (tab.id === activeTab.id ? { ...tab, label: "SSH" } : tab));
        }

        // First-open race: terminal may have created one default local tab
        // but activeTabIdRef is not updated yet. Reuse that tab instead of
        // spawning a second one.
        const firstLocal = prev.find((tab) => tab.mode.type === "local");
        if (firstLocal) {
          targetId = firstLocal.id;
          return prev.map((tab) => (tab.id === firstLocal.id ? { ...tab, label: "SSH" } : tab));
        }

        if (prev.length === 0) {
          targetId = nextTabId++;
          return [{ id: targetId, label: "SSH", mode: { type: "local" } }];
        }

        const id = nextTabId++;
        targetId = id;
        return [...prev, { id, label: "SSH", mode: { type: "local" } }];
      });
      if (targetId === null) return;
      setActiveTabId(targetId);

      // Write the command once the PTY is ready (small delay for spawn)
      setTimeout(() => {
        const handle = termRefs.current.get(targetId!);
        if (handle) {
          const existingPending = pendingSshConnectByTabRef.current.get(targetId!);
          if (existingPending?.tunnelReadyTimerId) {
            window.clearTimeout(existingPending.tunnelReadyTimerId);
          }
          // Reset stale terminal output so previous SSH errors don't poison
          // the state machine for a new tunnel launch in the reused SSH tab.
          outputBufferByTabRef.current.delete(targetId!);
          if (password) {
            pendingSshAuthByTabRef.current.set(targetId!, {
              password,
              sentPassword: false,
              sentHostConfirm: false,
            });
          } else {
            pendingSshAuthByTabRef.current.delete(targetId!);
          }
          pendingSshConnectByTabRef.current.set(targetId!, {
            command,
            passwordPromptNotified: false,
            connectionId,
            isTunnelOnly: command.includes(" -N ") || command.endsWith(" -N"),
          });
          handle.writeToPty(command + "\n");
        }
      }, 500);
    };

    window.addEventListener("ssh:execute", handler);
    return () => window.removeEventListener("ssh:execute", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTerminalOutput = useCallback((tabId: number, chunk: string) => {
    const normalized = stripAnsi(chunk).replace(/\r/g, "\n").toLowerCase();
    const prev = outputBufferByTabRef.current.get(tabId) ?? "";
    const text = (prev + normalized).slice(-4096);
    outputBufferByTabRef.current.set(tabId, text);
    const hasShellPrompt =
      /(?:^|\n)[^\n]*[$#>]\s*$/.test(text) ||
      text.includes("welcome to") ||
      text.includes("last login:");

    const pendingConnect = pendingSshConnectByTabRef.current.get(tabId);
    if (pendingConnect) {
      const asksForPassword = /(password|passphrase)[^:\n\r]{0,120}:\s*$/.test(text);
      const hasConnectionFailure =
        text.includes("permission denied") ||
        text.includes("authentication failed") ||
        text.includes("connection refused") ||
        text.includes("could not resolve hostname") ||
        text.includes("connection timed out");

      if (hasConnectionFailure) {
        if (pendingConnect.connectionId && pendingConnect.isTunnelOnly) {
          window.dispatchEvent(
            new CustomEvent("ssh:tunnel-status", {
              detail: {
                connectionId: pendingConnect.connectionId,
                status: "error",
                message: "Tunnel failed to connect",
              },
            }),
          );
        }
        if (pendingConnect.tunnelReadyTimerId) {
          window.clearTimeout(pendingConnect.tunnelReadyTimerId);
        }
        pendingSshConnectByTabRef.current.delete(tabId);
      } else if (hasShellPrompt) {
        const tabLabel = tabsRef.current.find((tab) => tab.id === tabId)?.label;
        window.dispatchEvent(new CustomEvent("ssh:connected", {
          detail: {
            tabId,
            tabLabel,
            command: pendingConnect.command,
          },
        }));
        if (pendingConnect.tunnelReadyTimerId) {
          window.clearTimeout(pendingConnect.tunnelReadyTimerId);
        }
        pendingSshConnectByTabRef.current.delete(tabId);
      } else if (asksForPassword) {
        const pendingAuth = pendingSshAuthByTabRef.current.get(tabId);
        if (!pendingAuth && !pendingConnect.passwordPromptNotified) {
          pendingConnect.passwordPromptNotified = true;
          pendingSshConnectByTabRef.current.set(tabId, pendingConnect);
          useNotificationStore.getState().addNotification({
            type: "info",
            title: "SSH password required",
            description: "Type password in terminal (input is hidden by SSH).",
            source: "composer",
          });
        }
      }
    }

    const pending = pendingSshAuthByTabRef.current.get(tabId);
    if (!pending) return;
    const handle = termRefs.current.get(tabId);
    if (!handle) return;

    if (!pending.sentHostConfirm && text.includes("are you sure you want to continue connecting")) {
      pending.sentHostConfirm = true;
      handle.writeToPty("yes\n");
      pendingSshAuthByTabRef.current.set(tabId, pending);
      return;
    }
    const asksForPassword =
      /(password|passphrase)[^:\n\r]{0,120}:\s*$/.test(text);
    if (!pending.sentPassword && asksForPassword) {
      pending.sentPassword = true;
      handle.writeToPty(pending.password + "\n");
      pendingSshAuthByTabRef.current.set(tabId, pending);
      return;
    }

    if (
      text.includes("permission denied") ||
      text.includes("authentication failed") ||
      (pending.sentPassword && hasShellPrompt)
    ) {
      pendingSshAuthByTabRef.current.delete(tabId);
      outputBufferByTabRef.current.delete(tabId);
    }

    const connectAfterAuth = pendingSshConnectByTabRef.current.get(tabId);
    if (connectAfterAuth) {
      const isTunnelOnly =
        connectAfterAuth.command.includes(" -N ") ||
        connectAfterAuth.command.endsWith(" -N");
      if (isTunnelOnly) {
        const authState = pendingSshAuthByTabRef.current.get(tabId);
        const authLikelyComplete = authState ? authState.sentPassword : !connectAfterAuth.passwordPromptNotified;
        const hasFailure =
          text.includes("permission denied") ||
          text.includes("authentication failed") ||
          text.includes("connection refused") ||
          text.includes("could not resolve hostname") ||
          text.includes("connection timed out");
        if (authLikelyComplete && !hasFailure && !connectAfterAuth.tunnelReadyTimerId) {
          const timerId = window.setTimeout(() => {
            const latest = outputBufferByTabRef.current.get(tabId) ?? "";
            const stillPending = pendingSshConnectByTabRef.current.get(tabId);
            if (!stillPending) return;
            const failed =
              latest.includes("permission denied") ||
              latest.includes("authentication failed") ||
              latest.includes("connection refused") ||
              latest.includes("could not resolve hostname") ||
              latest.includes("connection timed out");
            if (!failed) {
              if (stillPending.connectionId) {
                window.dispatchEvent(
                  new CustomEvent("ssh:tunnel-status", {
                    detail: {
                      connectionId: stillPending.connectionId,
                      status: "ready",
                    },
                  }),
                );
              }
              useNotificationStore.getState().addNotification({
                type: "success",
                title: "Tunnel appears active",
                description: "SSH tunnel is running (no interactive shell for -N mode).",
                source: "composer",
              });
              pendingSshConnectByTabRef.current.delete(tabId);
            }
          }, 2200);
          pendingSshConnectByTabRef.current.set(tabId, {
            ...connectAfterAuth,
            tunnelReadyTimerId: timerId,
          });
        }
      }
    }
  }, []);

  /* ── Imperative handle proxy for context menu ───────────────── */
  const termRefProxy = useRef<TerminalEmulatorHandle | null>(null);
  // Keep proxy in sync with active tab
  useEffect(() => {
    termRefProxy.current = activeTermRef();
  });
  // Wrap in a ref object shape for TerminalContextMenu
  const termRefForCtx = useRef<TerminalEmulatorHandle | null>(null);
  termRefForCtx.current = activeTermRef();

  const [pos, setPos] = useState({ x: -1, y: -1 });
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const [maximized, setMaximized] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [visuallyHidden, setVisuallyHidden] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const terminalConfirmOnClose = useSettingsStore((s) => s.terminal.confirmOnClose);

  const live = useRef({ x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H });
  const preMax = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const rafId = useRef(0);
  const prevMinimized = useRef(minimized);
  const currentEdge = useRef<Edge>(null);
  const interactingRef = useRef(false);
  const maximizedRef = useRef(false);
  const resizeStartRef = useRef<((edge: NonNullable<Edge>, x: number, y: number) => void) | null>(null);

  // Keep refs in sync with state for use in native listeners
  useEffect(() => { interactingRef.current = interacting; }, [interacting]);
  useEffect(() => { maximizedRef.current = maximized; }, [maximized]);

  /* ── DOM write ────────────────────────────────────────────────── */
  const applyDOM = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const { x, y, w, h } = live.current;
    box.style.transform = `translate3d(${x}px,${y}px,0)`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
  }, []);

  const scheduleApply = useCallback(() => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => { rafId.current = 0; applyDOM(); });
  }, [applyDOM]);

  useEffect(() => { live.current = { x: pos.x, y: pos.y, w: size.w, h: size.h }; }, [pos, size]);

  useEffect(() => {
    if (isOpen && pos.x === -1) {
      const cx = Math.max(0, Math.round((window.innerWidth - DEFAULT_W) / 2));
      const cy = Math.max(APP_HEADER_H, Math.round((window.innerHeight - DEFAULT_H) / 2));
      live.current = { ...live.current, x: cx, y: cy };
      setPos({ x: cx, y: cy });
    }
    if (isOpen && !mounted) { setMounted(true); requestAnimationFrame(() => setVisible(true)); }
    if (!isOpen) { setVisible(false); setVisuallyHidden(false); }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!minimized && !visuallyHidden) {
      requestAnimationFrame(() => {
        activeTermRef()?.fit();
        activeTermRef()?.focus();
      });
    }
  }, [maximized, minimized, visuallyHidden, activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Minimize / restore animation ─────────────────────────────── */
  useEffect(() => {
    const wasMinimized = prevMinimized.current;
    prevMinimized.current = minimized;
    if (wasMinimized === minimized) return;
    if (!mounted || !visible) { setVisuallyHidden(minimized); return; }

    const box = boxRef.current;
    const btn = getTerminalBtnCenter();

    if (minimized && !wasMinimized) {
      if (box && btn) {
        const { x, y } = live.current;
        box.style.transformOrigin = `${btn.x - x}px ${btn.y - y}px`;
        box.style.transition = "transform var(--motion-duration-overlay) var(--motion-ease-overlay), opacity var(--motion-duration-navigation) var(--motion-ease-navigation)";
        box.style.transform = `translate3d(${x}px,${y}px,0) scale(0)`;
        box.style.opacity = "0";
        setTimeout(() => { box.style.transition = ""; box.style.transformOrigin = ""; setVisuallyHidden(true); }, 290);
      } else { setVisuallyHidden(true); }
    } else if (!minimized && wasMinimized) {
      setVisuallyHidden(false);
      requestAnimationFrame(() => {
        if (box && btn) {
          const { x, y } = live.current;
          box.style.transition = "none";
          box.style.transformOrigin = `${btn.x - x}px ${btn.y - y}px`;
          box.style.transform = `translate3d(${x}px,${y}px,0) scale(0)`;
          box.style.opacity = "0";
          requestAnimationFrame(() => {
            box.style.transition = "transform var(--motion-duration-overlay) var(--motion-ease-overlay), opacity var(--motion-duration-navigation) var(--motion-ease-exit)";
            box.style.transform = `translate3d(${x}px,${y}px,0) scale(1)`;
            box.style.opacity = "1";
            setTimeout(() => { box.style.transition = ""; box.style.transformOrigin = ""; activeTermRef()?.fit(); activeTermRef()?.focus(); }, 290);
          });
        }
      });
    }
  }, [minimized]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Commit ───────────────────────────────────────────────────── */
  const commit = useCallback(() => {
    setInteracting(false);
    forceCursor(null);
    document.body.style.userSelect = "";
    setPos({ x: live.current.x, y: live.current.y });
    setSize({ w: live.current.w, h: live.current.h });
    requestAnimationFrame(() => { activeTermRef()?.fit(); activeTermRef()?.focus(); });
  }, [activeTermRef]);

  /* ── Resize ───────────────────────────────────────────────────── */
  const startResize = useCallback((edge: NonNullable<Edge>, clientX: number, clientY: number) => {
    setInteracting(true);
    forceCursor(EDGE_CURSOR[edge] ?? null);
    document.body.style.userSelect = "none";

    const sx = clientX, sy = clientY;
    const { x: ox, y: oy, w: ow, h: oh } = { ...live.current };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let nx = ox, ny = oy, nw = ow, nh = oh;
      if (edge.includes("e")) nw = clamp(ow + dx, MIN_W);
      if (edge.includes("w")) { nw = clamp(ow - dx, MIN_W); nx = ox + (ow - nw); }
      if (edge.includes("s")) nh = clamp(oh + dy, MIN_H);
      if (edge.includes("n")) { nh = clamp(oh - dy, MIN_H); ny = oy + (oh - nh); }
      live.current = { x: clamp(nx, 0), y: clamp(ny, 0), w: nw, h: nh };
      scheduleApply();
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      commit();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }, [scheduleApply, commit]);

  // Keep startResize accessible to native listener via ref
  useEffect(() => { resizeStartRef.current = startResize; }, [startResize]);

  /* ── Native document-level listeners for cursor + click ───────── */
  useEffect(() => {
    if (!isOpen) return;

    /** Detect edge proximity on every mouse move — runs on document in capture phase. */
    const onMove = (e: PointerEvent) => {
      if (interactingRef.current || maximizedRef.current) return;
      const box = boxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // Check if pointer is inside the window bounds
      const inside = px >= 0 && py >= 0 && px <= rect.width && py <= rect.height;
      if (!inside) {
        if (currentEdge.current !== null) {
          currentEdge.current = null;
          forceCursor(null);
        }
        return;
      }

      const edge = hitTestEdge(px, py, rect.width, rect.height);
      if (edge !== currentEdge.current) {
        currentEdge.current = edge;
        forceCursor(edge ? (EDGE_CURSOR[edge] ?? null) : null);
      }
    };

    /** Intercept clicks near edges before xterm can consume them. */
    const onDown = (e: PointerEvent) => {
      if (interactingRef.current || maximizedRef.current || e.button !== 0) return;
      const box = boxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const inside = px >= 0 && py >= 0 && px <= rect.width && py <= rect.height;
      if (!inside) return;

      const edge = hitTestEdge(px, py, rect.width, rect.height);
      if (edge) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        resizeStartRef.current?.(edge, e.clientX, e.clientY);
      }
    };

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerdown", onDown, true);

    return () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerdown", onDown, true);
      forceCursor(null);
    };
  }, [isOpen]);

  /* ── Drag (title bar) ─────────────────────────────────────────── */
  const onDragPointerDown = useCallback((e: React.PointerEvent) => {
    if (maximized || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();

    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setInteracting(true);
    forceCursor("grabbing");
    document.body.style.userSelect = "none";

    const sx = e.clientX, sy = e.clientY;
    const ox = live.current.x, oy = live.current.y;

    const onMove = (ev: PointerEvent) => {
      live.current.x = clamp(ox + ev.clientX - sx, 0);
      live.current.y = clamp(oy + ev.clientY - sy, 0);
      scheduleApply();
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      commit();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }, [maximized, scheduleApply, commit]);

  /* ── Window controls ──────────────────────────────────────────── */
  const handleMinimize = useCallback(() => { onMinimizedChange(!minimized); }, [minimized, onMinimizedChange]);

  const handleMaximize = useCallback(() => {
    if (maximized) {
      if (preMax.current) {
        live.current = { ...preMax.current };
        setPos({ x: preMax.current.x, y: preMax.current.y });
        setSize({ w: preMax.current.w, h: preMax.current.h });
      }
      setMaximized(false);
    } else {
      preMax.current = { ...live.current };
      setMaximized(true);
      if (minimized) onMinimizedChange(false);
    }
  }, [maximized, minimized, onMinimizedChange]);

  /** Actually close the terminal (no confirmation). */
  const doClose = useCallback(() => {
    pendingCloseRef.current = false;
    setVisible(false);
    forceCursor(null);
    setTimeout(() => {
      setMounted(false); setMaximized(false);
      setPos({ x: -1, y: -1 }); setSize({ w: DEFAULT_W, h: DEFAULT_H });
      live.current = { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };
      setTabs([]); setActiveTabId(null);
      termRefs.current.clear();
      pendingSshAuthByTabRef.current.clear();
      for (const pending of pendingSshConnectByTabRef.current.values()) {
        if (pending.tunnelReadyTimerId) window.clearTimeout(pending.tunnelReadyTimerId);
      }
      pendingSshConnectByTabRef.current.clear();
      outputBufferByTabRef.current.clear();
      handledSshExecuteIdsRef.current.clear();
      onMinimizedChange(false); onClose();
    }, 120);
  }, [onClose, onMinimizedChange]);

  /** Close handler — shows confirmation if enabled. */
  const handleClose = useCallback(() => {
    if (terminalConfirmOnClose && tabs.length > 0) {
      setShowCloseConfirm(true);
    } else {
      doClose();
    }
  }, [terminalConfirmOnClose, tabs.length, doClose]);

  if (!isOpen) return null;
  const isHidden = visuallyHidden;

  const boxStyle: React.CSSProperties = maximized
    ? { position: "fixed", left: 0, top: APP_HEADER_H, width: "100vw", height: `calc(100vh - ${APP_HEADER_H}px)`, transform: "none", borderRadius: 0 }
    : { position: "fixed", left: 0, top: 0, transform: `translate3d(${pos.x}px,${pos.y}px,0)`, width: size.w, height: size.h };

  return (
    <>
      {/* Overlay blocks xterm from stealing events during drag/resize.
          Cursor comes from the injected <style> tag via forceCursor(). */}
      {interacting && <div className="fixed inset-0 z-[9997]" />}

      <div
        ref={boxRef}
        draggable={false}
        className={cn(
          "fixed z-[9999] flex flex-col select-none",
          "rounded-lg bg-card shadow-card",
          visible && !isHidden ? "opacity-100" : "opacity-0",
          isHidden && "pointer-events-none"
        )}
        style={boxStyle}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* ── Title bar ────────────────────────────────────────── */}
        <div
          className={cn(
            "flex items-center gap-2 px-3 flex-shrink-0 bg-card",
            "rounded-t-lg border-b border-border/40",
            !maximized && "cursor-grab active:cursor-grabbing"
          )}
          data-has-context-menu
          style={{ height: TITLE_BAR_H, touchAction: "none" }}
          onPointerDown={onDragPointerDown}
          onDoubleClick={handleMaximize}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ open: true, x: e.clientX, y: e.clientY }); }}
        >
          <Terminal className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span className="text-xs font-medium text-foreground/80 truncate flex-1">Terminal</span>
          <div className="flex items-center gap-0.5">
            <TooltipWrapper title={minimized ? "Restore" : "Minimize"} description={minimized ? "Restore the terminal window." : "Minimize the terminal to the task bar."}>
              <button onClick={handleMinimize} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-smooth">
                <Minus className="h-3 w-3" />
              </button>
            </TooltipWrapper>
            <TooltipWrapper title={maximized ? "Restore" : "Maximize"} description={maximized ? "Restore the terminal to its previous size." : "Maximize the terminal window."}>
              <button onClick={handleMaximize} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-smooth">
                {maximized ? <MinimizeScreen className="h-3 w-3" /> : <MaximizeScreen className="h-3 w-3" />}
              </button>
            </TooltipWrapper>
            <TooltipWrapper title="Close" description="Close the terminal window. All sessions will end.">
              <button onClick={handleClose} className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-smooth">
                <X className="h-3 w-3" />
              </button>
            </TooltipWrapper>
          </div>
        </div>

        {/* ── Tab bar ─────────────────────────────────────────── */}
        <div
          className="flex items-end flex-shrink-0 border-b border-border overflow-x-auto bg-card/40"
          style={{ height: TAB_BAR_H, scrollbarWidth: "none" }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isEditing = editingTabId === tab.id;
            return (
              <div
                key={tab.id}
                className={cn(
                  "group relative flex items-center gap-1.5 px-3 h-full text-xs font-medium cursor-pointer select-none transition-smooth shrink-0",
                  "border-r border-border/50",
                  isActive
                    ? "text-foreground bg-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
                onClick={() => {
                  if (isEditing) return;
                  setActiveTabId(tab.id);
                  requestAnimationFrame(() => { termRefs.current.get(tab.id)?.fit(); termRefs.current.get(tab.id)?.focus(); });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingTabId(tab.id);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) { e.preventDefault(); closeTab(tab.id); }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTabCtxMenu({ open: true, x: e.clientX, y: e.clientY, tabId: tab.id });
                }}
              >
                {tab.mode.type === "remote" ? (
                  <Globe className="h-3 w-3 flex-shrink-0 text-primary/80" />
                ) : (
                  <Terminal className="h-3 w-3 flex-shrink-0 opacity-60" />
                )}
                {isEditing ? (
                  <input
                    autoFocus
                    defaultValue={tab.label}
                    className="bg-transparent outline-none text-xs font-medium text-foreground min-w-[40px] max-w-[120px] border-b border-primary/50 px-0.5"
                    onBlur={(e) => {
                      renameTab(tab.id, e.currentTarget.value);
                      setEditingTabId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        renameTab(tab.id, e.currentTarget.value);
                        setEditingTabId(null);
                      } else if (e.key === "Escape") {
                        setEditingTabId(null);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                ) : (
                  <span className="truncate max-w-[100px]">{tab.label}</span>
                )}
                {/* Close button — always visible on active tab, on hover for others */}
                {!isEditing && (
                  <TooltipWrapper title="Close tab" description="Close this terminal tab.">
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                      className={cn(
                        "p-0.5 rounded-lg transition-smooth flex-shrink-0",
                        "hover:bg-accent hover:text-foreground",
                        isActive
                          ? "text-muted-foreground"
                          : "text-transparent group-hover:text-muted-foreground"
                      )}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </TooltipWrapper>
                )}
                {/* Active indicator line */}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-primary" />
                )}
              </div>
            );
          })}
          {/* New tab: local + remote agent dropdown */}
          <div className="flex items-center h-full flex-shrink-0">
            <TooltipWrapper title="New local tab" description="Open a new local terminal tab.">
              <button
                onClick={addTab}
                className="flex items-center justify-center h-full px-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-smooth"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </TooltipWrapper>
            <AgentTabPicker onSelectAgent={addRemoteTab} />
          </div>
        </div>

        {/* ── Terminal body ─────────────────────────────────── */}
        {mounted && (
          <div
            className="flex-1 min-h-0 rounded-b-lg overflow-hidden"
            style={{ background: "hsl(var(--terminal-bg))" }}
            data-has-context-menu
            onClick={() => activeTermRef()?.focus()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ open: true, x: e.clientX, y: e.clientY }); }}
          >
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className="w-full h-full"
                style={{ display: tab.id === activeTabId ? "block" : "none" }}
              >
                <TerminalEmulator
                  ref={(handle) => setTermRef(tab.id, handle)}
                  mode={tab.mode}
                  onContextMenu={(x, y) => setCtxMenu({ open: true, x, y })}
                  onOutputChunk={(data) => handleTerminalOutput(tab.id, data)}
                />
              </div>
            ))}
          </div>
        )}

        <TerminalContextMenu
          open={ctxMenu.open} x={ctxMenu.x} y={ctxMenu.y}
          onClose={() => setCtxMenu((prev) => ({ ...prev, open: false }))}
          termRef={termRefForCtx} maximized={maximized} minimized={minimized}
          onMinimize={handleMinimize} onMaximize={handleMaximize} onCloseTerminal={handleClose}
        />

        <TabContextMenu
          open={tabCtxMenu.open}
          x={tabCtxMenu.x}
          y={tabCtxMenu.y}
          tabId={tabCtxMenu.tabId}
          tabCount={tabs.length}
          onClose={() => setTabCtxMenu((prev) => ({ ...prev, open: false }))}
          onRename={(tabId) => { setEditingTabId(tabId); }}
          onClose_tab={closeTab}
          onCloseOthers={closeOtherTabs}
          onCloseToRight={closeTabsToRight}
          onNewTab={addTab}
        />
      </div>

      <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <AlertDialogContent className="z-[10001]" overlayClassName="z-[10000]">
          <AlertDialogHeader>
            <AlertDialogTitle>Close Terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              {`This will terminate ${tabs.length} active session${tabs.length !== 1 ? "s" : ""}. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { setShowCloseConfirm(false); doClose(); }}
            >
              Close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
