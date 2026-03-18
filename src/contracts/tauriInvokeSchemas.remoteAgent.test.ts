import { describe, expect, it } from "vitest";
import { tauriInvokePayloadSchemas } from "@/contracts/tauriInvokeSchemas";

describe("remote_agent_generate payload compatibility", () => {
  const schema = tauriInvokePayloadSchemas.remote_agent_generate;
  if (!schema) {
    throw new Error("remote_agent_generate payload schema is missing");
  }

  it("accepts legacy payloads without explicit experience", () => {
    const parsed = schema.safeParse({
      params: {
        target_os: "windows",
        controller_address: "relay.zyfi.io/session/abc",
        use_tls: true,
        auth_token: "token",
        expires_seconds: null,
        label: null,
        profile: "full",
      },
      outputPath: "/tmp/agent.exe",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts explicit minimal/full experience payloads", () => {
    const minimal = schema.safeParse({
      params: {
        target_os: "windows",
        controller_address: "relay.zyfi.io/session/abc",
        use_tls: true,
        auth_token: "token",
        expires_seconds: null,
        label: null,
        profile: "minimal",
        experience: "minimal",
        daemon_headless: true,
      },
      outputPath: "/tmp/agent.exe",
    });
    expect(minimal.success).toBe(true);

    const full = schema.safeParse({
      params: {
        target_os: "macos-arm64",
        controller_address: "relay.zyfi.io/session/xyz",
        use_tls: true,
        auth_token: "token",
        expires_seconds: 3600,
        label: "Demo",
        profile: "full",
        experience: "full",
      },
      outputPath: "/tmp/agent",
    });
    expect(full.success).toBe(true);
  });
});
