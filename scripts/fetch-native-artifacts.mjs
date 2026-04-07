#!/usr/bin/env node
import { copyFileSync, createWriteStream, existsSync, mkdtempSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const args = {
    source: process.env.SIPALYZER_NATIVE_ARTIFACTS_URL ?? "",
    dest: join(ROOT, ".tmp", "native-artifacts"),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") {
      args.source = argv[i + 1] ?? "";
      i++;
    } else if (argv[i] === "--dest") {
      args.dest = resolve(argv[i + 1] ?? args.dest);
      i++;
    }
  }
  return args;
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
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

function ensureCommand(command, message) {
  if (!commandExists(command)) {
    throw new Error(message);
  }
}

function promoteStagedDirectory(stagedDir, destDir) {
  const parent = dirname(destDir);
  const backupDir = join(parent, `.native-artifacts-backup-${process.pid}-${Date.now()}`);
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

async function resolveArchive(source, tmpDir) {
  if (existsSync(source)) {
    const localArchive = join(tmpDir, basename(source));
    copyFileSync(source, localArchive);
    return localArchive;
  }
  const response = await fetch(source);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${source} (${response.status})`);
  }
  const urlPath = new URL(source).pathname;
  const archiveName = basename(urlPath) || "native-artifacts.tar.gz";
  const archivePath = join(tmpDir, archiveName);
  await pipeline(response.body, createWriteStream(archivePath));
  return archivePath;
}

function isTarGz(path) {
  return path.endsWith(".tar.gz") || path.endsWith(".tgz");
}

async function main() {
  const { source, dest } = parseArgs(process.argv.slice(2));
  if (!source) {
    console.error("Missing source. Set SIPALYZER_NATIVE_ARTIFACTS_URL or pass --source <url-or-archive-path>.");
    process.exit(1);
  }

  const tmpDir = join(ROOT, ".tmp");
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(dirname(dest), { recursive: true });
  const stagedDest = mkdtempSync(join(tmpDir, "native-artifacts-staged-"));

  const archivePath = await resolveArchive(source, tmpDir);
  if (!isTarGz(archivePath)) {
    throw new Error(
      `Unsupported archive format: ${extname(archivePath)}. Use .tar.gz artifact bundles with target directories.`,
    );
  }

  ensureCommand("tar", "Missing required command: tar");
  await run("tar", ["-xzf", archivePath, "-C", stagedDest]);
  promoteStagedDirectory(stagedDest, dest);
  console.log(`==> Native artifacts extracted to: ${dest}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
