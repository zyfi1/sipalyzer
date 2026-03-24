#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const logDir = mkdtempSync(join(tmpdir(), "sipalyzer-vite-"));
const viteLogPath = join(logDir, "dev.log");
const viteLog = createWriteStream(viteLogPath, { flags: "a" });

let viteChild = null;
let tauriChild = null;

function resolveCommand(command) {
  if (process.platform !== "win32") return command;
  if (command.endsWith(".cmd") || command.endsWith(".exe")) return command;
  return `${command}.cmd`;
}

function commandNeedsShell(command) {
  return process.platform === "win32" && command.endsWith(".cmd");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const resolvedCommand = resolveCommand(command);
    const child = spawn(resolvedCommand, args, {
      stdio: "inherit",
      env: { ...process.env, ...(options.env ?? {}) },
      shell: commandNeedsShell(resolvedCommand),
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function waitForVite(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (viteChild?.exitCode !== null && viteChild?.exitCode !== undefined) {
      throw new Error(`Vite exited unexpectedly. Check logs: ${viteLogPath}`);
    }
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) return;
    } catch {
      // Keep polling.
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for Vite at ${url}. Logs: ${viteLogPath}`);
}

function killChild(child) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // Ignore best-effort cleanup errors.
  }
}

function cleanupAndExit(code) {
  killChild(viteChild);
  killChild(tauriChild);
  viteLog.end();
  process.exit(code);
}

function resolveWindowsOpenSslEnv() {
  if (process.platform !== "win32") return {};
  const baseDir =
    process.env.OPENSSL_DIR ??
    join(process.env.USERPROFILE ?? "C:\\Users\\Public", "vcpkg", "installed", "x64-windows-static-md");
  const libDir = process.env.OPENSSL_LIB_DIR ?? join(baseDir, "lib");
  const includeDir = process.env.OPENSSL_INCLUDE_DIR ?? join(baseDir, "include");
  if (!existsSync(libDir) || !existsSync(includeDir)) return {};
  return {
    OPENSSL_DIR: baseDir,
    OPENSSL_LIB_DIR: libDir,
    OPENSSL_INCLUDE_DIR: includeDir,
    OPENSSL_STATIC: process.env.OPENSSL_STATIC ?? "1",
  };
}

function resolveWindowsBundledLibEnv() {
  if (process.platform !== "win32") return {};
  const targetTriple = process.env.TARGET ?? "x86_64-pc-windows-msvc";
  const bundledLibDir = join(process.cwd(), "src-tauri", "vendor", "libs", targetTriple);
  const pathEntries = [];
  if (existsSync(bundledLibDir)) {
    pathEntries.push(bundledLibDir);
  }
  const npcapRuntimeDir = join(process.env.WINDIR ?? "C:\\Windows", "System32", "Npcap");
  if (existsSync(npcapRuntimeDir)) {
    pathEntries.push(npcapRuntimeDir);
  }
  if (pathEntries.length === 0) return {};
  const pathValue = process.env.PATH ?? "";
  return {
    PATH: [...pathEntries, pathValue].filter(Boolean).join(delimiter),
  };
}

async function main() {
  if (process.env.SIPALYZER_DEV_PREBUILD === "1") {
    await run("npm", ["run", "build"]);
  }

  const opensslEnv = resolveWindowsOpenSslEnv();
  const bundledLibEnv = resolveWindowsBundledLibEnv();
  const sharedEnv = {
    CARGO_TARGET_DIR:
      process.env.CARGO_TARGET_DIR ?? "src-tauri/target/dev-run",
    CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? "0",
    TAURI_CLI_WATCHER_IGNORE:
      process.env.TAURI_CLI_WATCHER_IGNORE ??
      "src-tauri/target/**,src-tauri/target-packet-fidelity/**,src-tauri/target-agent-check/**,src-tauri/target-codex-check/**",
    ...opensslEnv,
    ...bundledLibEnv,
  };

  const viteCommand = resolveCommand("npm");
  viteChild = spawn(viteCommand, ["run", "dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...sharedEnv },
    shell: commandNeedsShell(viteCommand),
  });
  viteChild.stdout.pipe(viteLog);
  viteChild.stderr.pipe(viteLog);

  process.on("SIGINT", () => cleanupAndExit(130));
  process.on("SIGTERM", () => cleanupAndExit(143));

  await waitForVite("http://127.0.0.1:1420/", 45_000);
  console.log("Vite dev server is healthy at http://127.0.0.1:1420");

  const tauriConfig = JSON.stringify({
    build: {
      beforeDevCommand:
        "echo frontend dev server managed by run-tauri-dev-stable.mjs",
    },
  });
  const tauriConfigPath = join(logDir, "tauri-dev-config.json");
  writeFileSync(tauriConfigPath, tauriConfig, "utf8");

  const tauriCommand = resolveCommand("tauri");
  tauriChild = spawn(
    tauriCommand,
    ["dev", "--no-watch", "--no-dev-server-wait", "--config", tauriConfigPath],
    {
      stdio: "inherit",
      env: { ...process.env, ...sharedEnv },
      shell: commandNeedsShell(tauriCommand),
    }
  );

  tauriChild.on("close", (code) => {
    killChild(viteChild);
    viteLog.end();
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  cleanupAndExit(1);
});
