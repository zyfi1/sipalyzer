#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LIBS_ROOT = join(ROOT, "src-tauri", "vendor", "libs");
const SPANDSP_SRC = join(ROOT, "src-tauri", "vendor", "spandsp", "src");
const manifest = JSON.parse(readFileSync(join(LIBS_ROOT, "manifest.json"), "utf8"));

function hostTarget() {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin";
  if (process.platform === "darwin" && process.arch === "x64") return "x86_64-apple-darwin";
  if (process.platform === "linux" && process.arch === "x64") return "x86_64-unknown-linux-gnu";
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc";
  return null;
}

function parseArgs(argv) {
  let target = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") {
      target = argv[i + 1] ?? null;
      i++;
    }
  }
  return { target };
}

function copyIfExists(src, dest) {
  if (!existsSync(src)) return false;
  cpSync(src, dest);
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target ?? hostTarget();
  if (!target) {
    console.error("Unable to infer host target; pass --target <triple>.");
    process.exit(1);
  }
  const spec = manifest.targets?.[target];
  if (!spec) {
    console.error(`Target '${target}' not found in manifest.`);
    process.exit(1);
  }

  const targetDir = join(LIBS_ROOT, target);
  const includeDir = join(targetDir, "include");
  mkdirSync(targetDir, { recursive: true });
  mkdirSync(includeDir, { recursive: true });

  let copied = 0;
  for (const lib of spec.libraries ?? []) {
    const src = join(LIBS_ROOT, lib);
    const dest = join(targetDir, lib);
    if (copyIfExists(src, dest)) {
      copied++;
      console.log(`[copied] ${lib}`);
    } else {
      console.log(`[missing] ${lib} in legacy root`);
    }
  }

  // Export deterministic headers for bindgen/native UDPTL compile.
  const configHeader = target.includes("windows")
    ? join(SPANDSP_SRC, "msvc", "spandsp.h")
    : join(SPANDSP_SRC, "config", "spandsp.h");
  copyIfExists(configHeader, join(includeDir, "spandsp.h"));
  if (existsSync(join(SPANDSP_SRC, "spandsp"))) {
    cpSync(join(SPANDSP_SRC, "spandsp"), join(includeDir, "spandsp"), { recursive: true });
  }

  console.log(`[done] staged ${copied} libraries for ${target} -> ${targetDir}`);
}

main();
