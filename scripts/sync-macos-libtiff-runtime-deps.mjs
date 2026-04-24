#!/usr/bin/env node
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LIBS_ROOT = join(ROOT, "src-tauri", "vendor", "libs");
const DYLIBS = ["libzstd.dylib", "libjpeg.dylib", "liblzma.dylib"];

function rustcHostTriple() {
  try {
    const v = execSync("rustc -vV", { encoding: "utf8" });
    const m = v.match(/^host:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function sourceCandidates(libName) {
  return [join("/opt/homebrew/lib", libName), join("/usr/local/lib", libName)];
}

function resolveSource(libName) {
  for (const candidate of sourceCandidates(libName)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const host = rustcHostTriple();
  if (!host || !host.includes("apple-darwin")) {
    console.log("==> Non-macOS host detected; skipping TIFF runtime dependency sync.");
    return;
  }

  const targetDir = join(LIBS_ROOT, host);
  if (!existsSync(targetDir)) {
    console.log(`==> Host vendor dir missing (${targetDir}); skipping dependency sync.`);
    return;
  }

  for (const libName of DYLIBS) {
    const src = resolveSource(libName);
    const dest = join(targetDir, libName);
    if (!src) {
      console.warn(`==> Missing ${libName} in /opt/homebrew/lib or /usr/local/lib; skipping.`);
      continue;
    }
    rmSync(dest, { force: true });
    copyFileSync(src, dest);
    console.log(`==> Synced ${libName} -> ${dest}`);
  }
}

main();
