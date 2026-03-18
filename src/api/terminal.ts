/**
 * Terminal API — typed wrappers for terminal emulator backend commands.
 */

import { invokeTauri } from "./invoke";

/** Spawn a new terminal session. Returns the session ID. */
export async function spawnTerminal(cols?: number, rows?: number): Promise<string> {
  return invokeTauri<string>("terminal_spawn", { cols, rows });
}

/** Write data (keystrokes) to a terminal session's PTY stdin. */
export async function writeTerminal(sessionId: string, data: string): Promise<void> {
  return invokeTauri<void>("terminal_write", { sessionId, data });
}

/** Resize a terminal session's PTY. */
export async function resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  return invokeTauri<void>("terminal_resize", { sessionId, cols, rows });
}

/** Kill a terminal session and clean up resources. */
export async function killTerminal(sessionId: string): Promise<void> {
  return invokeTauri<void>("terminal_kill", { sessionId });
}

/** Ensure terminal backend runtime is ready before SSH tunnel flows. */
export async function ensureTerminalRuntimeReady(): Promise<void> {
  return invokeTauri<void>("terminal_ensure_runtime_ready");
}
