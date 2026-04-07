#!/usr/bin/env node
import { createWriteStream, existsSync, mkdtempSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GO_VERSION = "1.24.0";
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TOOLCHAIN_DIR = join(ROOT, "src-tauri", "resources", "toolchains", "go");

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore", shell: false });
  if (!result.error) return true;
  const fallback = spawnSync(command, ["-version"], { stdio: "ignore", shell: false });
  return !fallback.error;
}

function resolvePowerShell() {
  if (process.platform !== "win32") return null;
  if (commandExists("pwsh")) return "pwsh";
  if (commandExists("powershell")) return "powershell";
  throw new Error("Neither pwsh nor powershell is available on PATH");
}

function ensureCommand(command, message) {
  if (!commandExists(command)) {
    throw new Error(message);
  }
}

function promoteStagedDirectory(stagedDir, destDir) {
  const parent = dirname(destDir);
  const backupDir = join(parent, `.go-toolchain-backup-${process.pid}-${Date.now()}`);
  const destExists = existsSync(destDir);
  let movedToBackup = false;
  try {
    if (destExists) {
      renameSync(destDir, backupDir);
      movedToBackup = true;
    }
    renameSync(stagedDir, destDir);
    if (movedToBackup) {
      rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    try {
      if (existsSync(destDir)) {
        rmSync(destDir, { recursive: true, force: true });
      }
      if (movedToBackup) {
        renameSync(backupDir, destDir);
      }
    } catch {
      // Preserve original failure below.
    }
    throw error;
  } finally {
    if (existsSync(stagedDir)) {
      rmSync(stagedDir, { recursive: true, force: true });
    }
  }
}

function resolveTarget() {
  const platform = process.platform;
  const arch = process.arch;
  const goArch = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : null;
  if (!goArch) throw new Error(`Unsupported architecture: ${arch}`);

  if (platform === "darwin") return { goos: "darwin", goarch: goArch, ext: "tar.gz" };
  if (platform === "linux") return { goos: "linux", goarch: goArch, ext: "tar.gz" };
  if (platform === "win32") return { goos: "windows", goarch: goArch, ext: "zip" };
  throw new Error(`Unsupported OS: ${platform}`);
}

async function download(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${url} (${response.status})`);
  }
  await pipeline(response.body, createWriteStream(outputPath));
}

async function main() {
  const { goos, goarch, ext } = resolveTarget();
  const archiveName = `go${GO_VERSION}.${goos}-${goarch}.${ext}`;
  const url = `https://go.dev/dl/${archiveName}`;
  const tmpDir = join(ROOT, ".tmp");
  const archivePath = join(tmpDir, archiveName);

  mkdirSync(tmpDir, { recursive: true });
  const stagedToolchainDir = mkdtempSync(join(tmpDir, "go-toolchain-staged-"));
  if (ext === "tar.gz") {
    ensureCommand("tar", "Missing required command: tar");
  }
  const powerShellCommand = ext === "zip" ? resolvePowerShell() : null;

  console.log(`==> Downloading Go ${GO_VERSION} for ${goos}/${goarch}`);
  console.log(`    URL: ${url}`);
  await download(url, archivePath);

  if (ext === "tar.gz") {
    await run("tar", ["-xzf", archivePath, "-C", stagedToolchainDir, "--strip-components=1"]);
  } else {
    await run(
      powerShellCommand,
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${stagedToolchainDir}" -Force`,
      ],
      { shell: false },
    );
    const nested = join(stagedToolchainDir, "go");
    if (existsSync(nested)) {
      for (const item of readdirSync(nested)) {
        const from = join(nested, item);
        const to = join(stagedToolchainDir, item);
        rmSync(to, { force: true, recursive: true });
        renameSync(from, to);
      }
      rmSync(nested, { recursive: true, force: true });
    }
  }

  promoteStagedDirectory(stagedToolchainDir, TOOLCHAIN_DIR);

  const goBin = process.platform === "win32"
    ? join(TOOLCHAIN_DIR, "bin", "go.exe")
    : join(TOOLCHAIN_DIR, "bin", "go");

  console.log(`==> Go toolchain installed to: ${TOOLCHAIN_DIR}`);
  await run(goBin, ["version"]);
  console.log(`==> Done (${basename(goBin)})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
