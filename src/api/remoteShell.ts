/**
 * Remote Shell API — Tauri IPC wrappers for interactive remote agent shell sessions.
 */

import { invokeTauri } from "./invoke";

/** Spawn a new shell session on a remote agent. Returns the session (message) ID. */
export async function spawnRemoteShell(
  agentId: string,
  cols: number,
  rows: number,
): Promise<string> {
  return invokeTauri<string>("remote_shell_spawn", { agentId, cols, rows });
}

/** Write input data to a remote shell session's PTY stdin. */
export async function writeRemoteShell(
  agentId: string,
  sessionId: string,
  data: string,
): Promise<void> {
  await invokeTauri<string>("remote_shell_write", { agentId, sessionId, data });
}

/** Resize a remote shell session's PTY. */
export async function resizeRemoteShell(
  agentId: string,
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await invokeTauri<string>("remote_shell_resize", {
    agentId,
    sessionId,
    cols,
    rows,
  });
}

/** Close a remote shell session. */
export async function closeRemoteShell(
  agentId: string,
  sessionId: string,
): Promise<void> {
  await invokeTauri<string>("remote_shell_close", { agentId, sessionId });
}
