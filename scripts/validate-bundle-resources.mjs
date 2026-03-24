#!/usr/bin/env node
/**
 * Ensures every path listed in tauri.conf.json `bundle.resources` exists under src-tauri/.
 * Run before `tauri build` so installers are not produced with missing trees (Go toolchain, Vosk model, etc.).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAURI_DIR = join(ROOT, "src-tauri");
const CONF = join(TAURI_DIR, "tauri.conf.json");

function main() {
  const raw = readFileSync(CONF, "utf8");
  const cfg = JSON.parse(raw);
  const resources = cfg?.bundle?.resources;
  if (!Array.isArray(resources)) {
    console.error("tauri.conf.json: bundle.resources must be an array.");
    process.exit(1);
  }

  let bad = false;
  for (const entry of resources) {
    if (typeof entry !== "string") {
      console.error(`bundle.resources: expected string entries, got ${typeof entry}`);
      bad = true;
      continue;
    }
    const p = join(TAURI_DIR, entry);
    if (!existsSync(p)) {
      console.error(`[missing] bundle.resources -> ${entry}`);
      console.error(`          expected at ${p}`);
      bad = true;
    } else {
      console.log(`[ok] ${entry}`);
    }
  }

  if (bad) {
    console.error("\nFix missing paths (e.g. run scripts/setup-go-toolchain.mjs) before bundling.");
    process.exit(1);
  }
}

main();
