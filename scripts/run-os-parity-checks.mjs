#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";

function spawnChecked(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function runStep(name, fn) {
  process.stdout.write(`\n==> ${name}\n`);
  await fn();
}

function npmCommand() {
  return isWindows ? "npm.cmd" : "npm";
}

function goBinaryPath() {
  return path.join(
    repoRoot,
    "src-tauri",
    "resources",
    "toolchains",
    "go",
    "bin",
    isWindows ? "go.exe" : "go",
  );
}

async function runGoBuildSmoke() {
  const goBin = goBinaryPath();
  if (!fs.existsSync(goBin)) {
    throw new Error(`Go binary not found at ${goBin}. Run npm run setup:go-toolchain first.`);
  }
  const agentDir = path.join(repoRoot, "src-tauri", "resources", "agent-go");
  const outDir = path.join(repoRoot, ".tmp", "os-parity");
  const goCacheDir = path.join(outDir, "gocache");
  const goModCacheDir = path.join(outDir, "gomodcache");
  const goPathDir = path.join(outDir, "gopath");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(goCacheDir, { recursive: true });
  fs.mkdirSync(goModCacheDir, { recursive: true });
  fs.mkdirSync(goPathDir, { recursive: true });

  const baseEnv = {
    GOROOT: path.resolve(path.join(goBin, "..", "..")),
    CGO_ENABLED: "0",
    GOPATH: goPathDir,
    GOCACHE: goCacheDir,
    GOMODCACHE: goModCacheDir,
  };

  const targets = [
    { goos: "windows", goarch: "amd64", output: path.join(outDir, "remote-agent-windows.exe") },
    { goos: "darwin", goarch: "amd64", output: path.join(outDir, "remote-agent-macos-amd64") },
    { goos: "darwin", goarch: "arm64", output: path.join(outDir, "remote-agent-macos-arm64") },
  ];

  for (const target of targets) {
    await spawnChecked(
      goBin,
      ["build", "-mod=vendor", "-tags=notray", "-o", target.output, "."],
      {
        cwd: agentDir,
        env: {
          ...baseEnv,
          GOOS: target.goos,
          GOARCH: target.goarch,
        },
      },
    );
  }
}

async function main() {
  const npm = npmCommand();

  await runStep("Frontend static/type checks", async () => {
    await spawnChecked(npm, ["run", "typecheck"]);
  });

  await runStep("Frontend regression tests", async () => {
    await spawnChecked(npm, ["run", "test"]);
  });

  await runStep("Frontend production build", async () => {
    await spawnChecked(npm, ["run", "build"]);
  });

  await runStep("Native artifact manifest validation", async () => {
    await spawnChecked(npm, ["run", "validate:native-artifacts"]);
  });

  await runStep("Packet fidelity checks", async () => {
    await spawnChecked(npm, ["run", "test:packet-fidelity"]);
  });

  await runStep("Rust app compile check", async () => {
    await spawnChecked("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets"]);
  });

  await runStep("Rust remote-agent targeted tests", async () => {
    await spawnChecked("cargo", [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "remote_agent::config_gen",
    ]);
  });

  await runStep("Remote Agent cross-target build smoke", async () => {
    await runGoBuildSmoke();
  });

  process.stdout.write("\nOS parity checks passed.\n");
}

main().catch((error) => {
  console.error("\nOS parity checks failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
