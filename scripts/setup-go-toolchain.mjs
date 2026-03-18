#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
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
  rmSync(TOOLCHAIN_DIR, { recursive: true, force: true });
  mkdirSync(TOOLCHAIN_DIR, { recursive: true });

  console.log(`==> Downloading Go ${GO_VERSION} for ${goos}/${goarch}`);
  console.log(`    URL: ${url}`);
  await download(url, archivePath);

  if (ext === "tar.gz") {
    await run("tar", ["-xzf", archivePath, "-C", TOOLCHAIN_DIR, "--strip-components=1"]);
  } else {
    await run(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${TOOLCHAIN_DIR}" -Force`,
      ],
      { shell: false },
    );
    const nested = join(TOOLCHAIN_DIR, "go");
    if (existsSync(nested)) {
      for (const item of readdirSync(nested)) {
        const from = join(nested, item);
        const to = join(TOOLCHAIN_DIR, item);
        rmSync(to, { force: true, recursive: true });
        renameSync(from, to);
      }
      rmSync(nested, { recursive: true, force: true });
    }
  }

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
