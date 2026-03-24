#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = join(ROOT, "src-tauri", "vendor", "libs", "manifest.json");

function parseArgs(argv) {
  const args = { strict: false, target: null, enforceAll: false, currentHost: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") args.strict = true;
    if (a === "--enforce-all") args.enforceAll = true;
    if (a === "--current-host") args.currentHost = true;
    if (a === "--target") {
      args.target = argv[i + 1] ?? null;
      i++;
    }
  }
  return args;
}

/** Rust host triple for this machine (`rustc -vV`). */
function rustcHostTriple() {
  try {
    const v = execSync("rustc -vV", { encoding: "utf8" });
    const m = v.match(/^host:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function checkTarget(baseDir, target, spec) {
  const dir = join(baseDir, target);
  const missing = [];
  for (const lib of spec.libraries ?? []) {
    if (!existsSync(join(dir, lib))) missing.push(lib);
  }
  if (spec.includeDir && !existsSync(join(dir, spec.includeDir))) {
    missing.push(`${spec.includeDir}/ (dir)`);
  }
  return { target, dir, missing };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const targets = manifest.targets ?? {};
  const baseDir = join(ROOT, "src-tauri", "vendor", "libs");

  if (args.currentHost) {
    if (args.target) {
      console.error("Use either --target or --current-host, not both.");
      process.exit(1);
    }
    const host = rustcHostTriple();
    if (!host) {
      console.error("Could not run `rustc -vV` or parse host triple.");
      process.exit(1);
    }
    if (!targets[host]) {
      console.error(
        `No vendor/libs manifest entry for this host (${host}). Add it to manifest.json.`
      );
      process.exit(1);
    }
    args.target = host;
  }

  const names = args.target ? [args.target] : Object.keys(targets);

  if (names.length === 0) {
    console.error("No targets defined in native artifact manifest.");
    process.exit(1);
  }

  let hasMissing = false;
  for (const name of names) {
    const spec = targets[name];
    if (!spec) {
      hasMissing = true;
      console.error(`Target not found in manifest: ${name}`);
      continue;
    }
    const result = checkTarget(baseDir, name, spec);
    const required = Boolean(spec.requiredForRelease) || args.enforceAll;
    if (result.missing.length === 0) {
      console.log(`[ok] ${name} -> ${result.dir}`);
    } else {
      if (required) hasMissing = true;
      const label = required ? "missing-required" : "missing-optional";
      console.log(`[${label}] ${name} -> ${result.dir}`);
      for (const m of result.missing) console.log(`  - ${m}`);
    }
  }

  if (hasMissing && args.strict) process.exit(1);
}

main();
