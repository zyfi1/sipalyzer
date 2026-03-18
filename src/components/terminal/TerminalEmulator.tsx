/**
 * TerminalEmulator — wraps xterm.js with Tauri PTY integration.
 *
 * Supports two modes:
 *  - "local": spawns a local PTY via the Tauri terminal commands
 *  - "remote": opens an interactive shell on a remote agent via WebSocket
 *
 * On mount: spawns a session, listens for output events, and writes keystrokes.
 * On unmount: kills the session and disposes the xterm instance.
 */

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen } from "@/lib/tauriEvents";
import { spawnTerminal, writeTerminal, resizeTerminal, killTerminal } from "@/api/terminal";
import {
  spawnRemoteShell,
  writeRemoteShell,
  resizeRemoteShell,
  closeRemoteShell,
} from "@/api/remoteShell";
import { useSettingsStore, type TerminalSettings } from "@/stores/settingsStore";
import { hslToHex } from "@/lib/monacoTheme";
import "@xterm/xterm/css/xterm.css";

export interface TerminalEmulatorHandle {
  /** Re-fit the terminal to its container */
  fit: () => void;
  /** Get the current text selection from the terminal */
  getSelection: () => string;
  /** Select all text in the terminal */
  selectAll: () => void;
  /** Clear the terminal viewport (keeps scrollback) */
  clear: () => void;
  /** Hard-reset the terminal (clears everything) */
  reset: () => void;
  /** Write data to the PTY stdin (used for paste) */
  writeToPty: (data: string) => void;
  /** Focus the terminal */
  focus: () => void;
  /** Whether there's an active selection */
  hasSelection: () => boolean;
}

export type TerminalMode =
  | { type: "local" }
  | { type: "remote"; agentId: string };

interface TerminalEmulatorProps {
  /** Terminal mode: local PTY or remote agent shell */
  mode?: TerminalMode;
  /** Called when the terminal session ends (PTY exited) */
  onExit?: () => void;
  /** Called on right-click inside the terminal (for context menu) */
  onContextMenu?: (x: number, y: number) => void;
  /** Raw output chunks from PTY/remote stream */
  onOutputChunk?: (data: string) => void;
}

/**
 * Build the xterm.js theme from design-system CSS variables at runtime.
 * Falls back to sensible hex values if variables aren't available (e.g. SSR).
 */
function buildTerminalTheme() {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string) => root.getPropertyValue(name).trim();
  const hsl = (name: string, fb: string) => { const raw = v(name); return raw ? hslToHex(raw) : fb; };
  const hex = (name: string, fb: string) => v(name) || fb;

  const bg = hsl("--terminal-bg", "#0a0c13");
  const fg = hsl("--foreground", "#f5f6f8");
  const mutedFg = hsl("--muted-foreground", "#8b92a8");
  const accent = hsl("--accent", "#2e3a54");
  const card = hsl("--card", "#1e2433");
  const primary = hsl("--primary", "#6b8dd6");
  const destructive = hsl("--destructive", "#d94f4f");
  const success = hsl("--success", "#45c890");
  const warning = hsl("--warning", "#e8a73a");
  const chartPurple = hex("--color-chart-purple", "#a78bfa");
  const chartCyan = hex("--color-chart-cyan", "#22d3ee");
  const chartGreen = hex("--color-chart-green", "#34d399");

  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: accent,
    selectionForeground: fg,
    black: card,
    red: destructive,
    green: success,
    yellow: warning,
    blue: primary,
    magenta: chartPurple,
    cyan: chartCyan,
    white: fg,
    brightBlack: mutedFg,
    brightRed: destructive,
    brightGreen: chartGreen,
    brightYellow: warning,
    brightBlue: primary,
    brightMagenta: chartPurple,
    brightCyan: chartCyan,
    brightWhite: fg,
  };
}

export const TerminalEmulator = forwardRef<TerminalEmulatorHandle, TerminalEmulatorProps>(
  function TerminalEmulator({ mode, onExit: _onExit, onContextMenu, onOutputChunk }, ref) {
    const resolvedMode: TerminalMode = mode ?? { type: "local" };
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const mountedRef = useRef(true);
    const onContextMenuRef = useRef(onContextMenu);
    onContextMenuRef.current = onContextMenu;
    const onOutputChunkRef = useRef(onOutputChunk);
    onOutputChunkRef.current = onOutputChunk;

    // Stable ref to mode so the mount effect can read it without re-running
    const modeRef = useRef(resolvedMode);
    modeRef.current = resolvedMode;

    const termSettings = useSettingsStore((s) => s.terminal);

    useImperativeHandle(ref, () => ({
      fit: () => {
        fitAddonRef.current?.fit();
      },
      getSelection: () => termRef.current?.getSelection() ?? "",
      selectAll: () => termRef.current?.selectAll(),
      clear: () => termRef.current?.clear(),
      reset: () => termRef.current?.reset(),
      writeToPty: (data: string) => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        const m = modeRef.current;
        if (m.type === "remote") {
          writeRemoteShell(m.agentId, sid, data).catch(() => {});
        } else {
          writeTerminal(sid, data);
        }
      },
      focus: () => termRef.current?.focus(),
      hasSelection: () => termRef.current?.hasSelection() ?? false,
    }));


    useEffect(() => {
      mountedRef.current = true;
      const container = containerRef.current;
      if (!container) return;

      const m = modeRef.current;
      const settings: TerminalSettings = useSettingsStore.getState().terminal;

      const term = new Terminal({
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        letterSpacing: 0,
        theme: buildTerminalTheme(),
        cursorBlink: settings.cursorBlink,
        cursorStyle: settings.cursorStyle,
        cursorWidth: 2,
        allowProposedApi: true,
        scrollback: settings.scrollback,
        convertEol: false,
        rightClickSelectsWord: false,
        windowOptions: {},
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(container);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      const onCtxMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenuRef.current?.(e.clientX, e.clientY);
      };
      container.addEventListener("contextmenu", onCtxMenu, true);

      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch { /* ignore */ }
      });

      let unlistenOutput: (() => void) | undefined;

      if (m.type === "local") {
        // ── Local PTY ──────────────────────────────────────────
        (async () => {
          try {
            const sessionId = await spawnTerminal(term.cols, term.rows);
            if (!mountedRef.current) {
              killTerminal(sessionId).catch(() => {});
              return;
            }
            sessionIdRef.current = sessionId;

            const sid = sessionId;
            unlistenOutput = await listen<{ session_id: string; data: string }>(
              "terminal:output",
              (event) => {
                if (event.payload.session_id === sid) {
                  term.write(event.payload.data);
                  onOutputChunkRef.current?.(event.payload.data);
                }
              }
            );

            term.onData((data) => {
              writeTerminal(sid, data).catch(() => {});
            });
            term.onBinary((data) => {
              writeTerminal(sid, data).catch(() => {});
            });
          } catch (e) {
            term.write(`\r\n\x1b[31mFailed to start terminal: ${e}\x1b[0m\r\n`);
          }
        })();
      } else {
        // ── Remote Agent Shell ─────────────────────────────────
        const agentId = m.agentId;

        // Ultra-low-latency micro-batcher with backpressure:
        // - tiny coalescing window for normal typing
        // - immediate flush for control/newline sequences
        // - serialize writes (one in flight) to reduce IPC churn
        const ULTRA_BATCH_MS = 4;
        let inputBuffer = "";
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        let writeInFlight = false;

        const isPriorityInput = (data: string): boolean => (
          data.includes("\r") ||
          data.includes("\n") ||
          data.includes("\x1b") ||
          /\x00|\x03|\x04|\x7f/.test(data)
        );

        const scheduleFlush = (delayMs: number) => {
          if (flushTimer) return;
          flushTimer = setTimeout(() => {
            flushTimer = null;
            flushInput();
          }, delayMs);
        };

        const flushInput = () => {
          const currentSid = sessionIdRef.current;
          if (!currentSid || writeInFlight || inputBuffer.length === 0) return;
          const chunk = inputBuffer;
          inputBuffer = "";
          writeInFlight = true;
          writeRemoteShell(agentId, currentSid, chunk)
            .catch(() => {})
            .finally(() => {
              writeInFlight = false;
              if (inputBuffer.length > 0) {
                // Drain quickly when backlog exists.
                scheduleFlush(0);
              }
            });
        };

        let unlistenDisconnect: (() => void) | undefined;

        (async () => {
          try {
            term.write("\x1b[90mConnecting to remote agent...\x1b[0m\r\n");

            const sessionId = await spawnRemoteShell(agentId, term.cols, term.rows);
            if (!mountedRef.current) {
              closeRemoteShell(agentId, sessionId).catch(() => {});
              return;
            }
            sessionIdRef.current = sessionId;

            const sid = sessionId;
            unlistenOutput = await listen<{ id: string; response: { type: string; data?: { data?: string; final_chunk?: boolean } } }>(
              "remote-agent:response",
              (event) => {
                const { id, response } = event.payload;
                const { type, data } = response;
                if (id !== sid) return;

                if (type === "StreamData" && data?.data) {
                  term.write(data.data);
                  onOutputChunkRef.current?.(data.data);
                }
                if (type === "StreamData" && data?.final_chunk) {
                  term.write("\r\n\x1b[90mRemote shell session ended.\x1b[0m\r\n");
                  sessionIdRef.current = null;
                }
                if (type === "Error") {
                  const errMsg = (data as unknown as { message?: string })?.message ?? "Unknown error";
                  term.write(`\r\n\x1b[31mRemote error: ${errMsg}\x1b[0m\r\n`);
                }
              }
            );

            // Listen for agent disconnection
            unlistenDisconnect = await listen<{ agent_id: string; reason?: string }>(
              "remote-agent:disconnected",
              (event) => {
                if (event.payload.agent_id !== agentId) return;
                if (!sessionIdRef.current) return;
                const reason = event.payload.reason ?? "unknown";
                term.write(`\r\n\x1b[31;1mConnection lost\x1b[0m \x1b[90m(${reason})\x1b[0m\r\n`);
                sessionIdRef.current = null;
              }
            );

            term.onData((data) => {
              inputBuffer += data;
              if (isPriorityInput(data)) {
                if (flushTimer) {
                  clearTimeout(flushTimer);
                  flushTimer = null;
                }
                flushInput();
                return;
              }
              scheduleFlush(ULTRA_BATCH_MS);
            });
            term.onBinary((data) => {
              inputBuffer += data;
              if (isPriorityInput(data)) {
                if (flushTimer) {
                  clearTimeout(flushTimer);
                  flushTimer = null;
                }
                flushInput();
                return;
              }
              scheduleFlush(ULTRA_BATCH_MS);
            });
          } catch (e) {
            term.write(`\r\n\x1b[31mFailed to connect remote shell: ${e}\x1b[0m\r\n`);
          }
        })();

        const originalUnmount = () => {
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          // Best-effort final flush before close.
          if (!writeInFlight && inputBuffer.length > 0) {
            flushInput();
          }
          unlistenDisconnect?.();
        };

        (container as any).__remoteCleanup = originalUnmount;
      }

      // Observe container resizes
      const observer = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (mountedRef.current) {
            try { fitAddon.fit(); } catch { /* ignore */ }
            const sid = sessionIdRef.current;
            if (sid) {
              const currentMode = modeRef.current;
              if (currentMode.type === "remote") {
                resizeRemoteShell(currentMode.agentId, sid, term.cols, term.rows).catch(() => {});
              } else {
                resizeTerminal(sid, term.cols, term.rows).catch(() => {});
              }
            }
          }
        });
      });
      observer.observe(container);

      return () => {
        mountedRef.current = false;
        observer.disconnect();
        unlistenOutput?.();
        container.removeEventListener("contextmenu", onCtxMenu, true);

        // Remote-specific cleanup
        if ((container as any).__remoteCleanup) {
          (container as any).__remoteCleanup();
          delete (container as any).__remoteCleanup;
        }

        const sid = sessionIdRef.current;
        if (sid) {
          const currentMode = modeRef.current;
          if (currentMode.type === "remote") {
            closeRemoteShell(currentMode.agentId, sid).catch(() => {});
          } else {
            killTerminal(sid).catch(() => {});
          }
          sessionIdRef.current = null;
        }

        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Live-sync settings changes to an already-open terminal
    useEffect(() => {
      const term = termRef.current;
      if (!term) return;
      term.options.fontSize = termSettings.fontSize;
      term.options.fontFamily = termSettings.fontFamily;
      term.options.lineHeight = termSettings.lineHeight;
      term.options.cursorStyle = termSettings.cursorStyle;
      term.options.cursorBlink = termSettings.cursorBlink;
      term.options.scrollback = termSettings.scrollback;
      try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
      const sid = sessionIdRef.current;
      if (sid) {
        const currentMode = modeRef.current;
        if (currentMode.type === "remote") {
          resizeRemoteShell(currentMode.agentId, sid, term.cols, term.rows).catch(() => {});
        } else {
          resizeTerminal(sid, term.cols, term.rows).catch(() => {});
        }
      }
    }, [termSettings]);

    return (
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ padding: "4px 0 4px 8px", background: "hsl(var(--terminal-bg))" }}
      />
    );
  }
);
