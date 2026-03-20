import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeTauriMock } = vi.hoisted(() => ({
  invokeTauriMock: vi.fn(),
}));

vi.mock("@/api/invoke", () => ({
  invokeTauri: invokeTauriMock,
}));

import {
  closeRemoteShell,
  resizeRemoteShell,
  spawnRemoteShell,
  writeRemoteShell,
} from "@/api/remoteShell";

describe("remote shell API wrappers", () => {
  beforeEach(() => {
    invokeTauriMock.mockReset();
  });

  it("passes spawn args and returns the session id", async () => {
    invokeTauriMock.mockResolvedValue("session-42");
    const result = await spawnRemoteShell("agent-1", 120, 40);
    expect(result).toBe("session-42");
    expect(invokeTauriMock).toHaveBeenCalledWith("remote_shell_spawn", {
      agentId: "agent-1",
      cols: 120,
      rows: 40,
    });
  });

  it("passes write args with exact input payload", async () => {
    invokeTauriMock.mockResolvedValue(undefined);
    await writeRemoteShell("agent-2", "session-9", "ls -la\n");
    expect(invokeTauriMock).toHaveBeenCalledWith("remote_shell_write", {
      agentId: "agent-2",
      sessionId: "session-9",
      data: "ls -la\n",
    });
  });

  it("passes resize args with deterministic dimensions", async () => {
    invokeTauriMock.mockResolvedValue(undefined);
    await resizeRemoteShell("agent-3", "session-7", 200, 55);
    expect(invokeTauriMock).toHaveBeenCalledWith("remote_shell_resize", {
      agentId: "agent-3",
      sessionId: "session-7",
      cols: 200,
      rows: 55,
    });
  });

  it("passes close args to the correct tauri command", async () => {
    invokeTauriMock.mockResolvedValue(undefined);
    await closeRemoteShell("agent-4", "session-11");
    expect(invokeTauriMock).toHaveBeenCalledWith("remote_shell_close", {
      agentId: "agent-4",
      sessionId: "session-11",
    });
  });
});
