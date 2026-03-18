#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LIBS_ROOT = join(ROOT, "src-tauri", "vendor", "libs");
const MANIFEST_PATH = join(LIBS_ROOT, "manifest.json");

function parseArgs(argv) {
  const args = { source: process.env.SIPALYZER_NATIVE_ARTIFACTS_DIR ?? "", target: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") {
      args.source = argv[i + 1] ?? "";
      i++;
    } else if (argv[i] === "--target") {
      args.target = argv[i + 1] ?? "";
      i++;
    }
  }
  return args;
}

function copyOneTarget(sourceRoot, target, spec) {
  const sourceTargetDir = join(sourceRoot, target);
  const destTargetDir = join(LIBS_ROOT, target);
  mkdirSync(destTargetDir, { recursive: true });
  if (spec.includeDir) {
    mkdirSync(join(destTargetDir, spec.includeDir), { recursive: true });
  }
  if (!existsSync(sourceTargetDir)) {
    console.log(`[skip] source target missing: ${sourceTargetDir}`);
    return;
  }

  for (const lib of spec.libraries ?? []) {
    const src = join(sourceTargetDir, lib);
    const dest = join(destTargetDir, lib);
    if (existsSync(src)) {
      if (resolve(src) === resolve(dest)) {
        console.log(`[skip] ${target}/${lib} already in place`);
      } else {
        cpSync(src, dest);
        console.log(`[copied] ${target}/${lib}`);
      }
    } else {
      console.log(`[missing] ${target}/${lib}`);
    }
  }

  if (spec.includeDir) {
    const srcInclude = join(sourceTargetDir, spec.includeDir);
    const destInclude = join(destTargetDir, spec.includeDir);
    if (existsSync(srcInclude)) {
      if (resolve(srcInclude) === resolve(destInclude)) {
        console.log(`[skip] ${target}/${spec.includeDir}/ already in place`);
      } else {
        cpSync(srcInclude, destInclude, { recursive: true });
        console.log(`[copied] ${target}/${spec.includeDir}/`);
      }
    } else {
      console.log(`[missing] ${target}/${spec.includeDir}/`);
    }
  }
}

function main() {
  const { source, target } = parseArgs(process.argv.slice(2));
  if (!source) {
    console.error("Missing source directory. Set SIPALYZER_NATIVE_ARTIFACTS_DIR or pass --source <path>.");
    process.exit(1);
  }
  const sourceRoot = resolve(source);
  if (!existsSync(sourceRoot)) {
    console.error(`Source directory does not exist: ${sourceRoot}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const targets = manifest.targets ?? {};
  const names = target ? [target] : Object.keys(targets);
  if (names.length === 0) {
    console.error("No targets found in manifest.");
    process.exit(1);
  }
  for (const name of names) {
    const spec = targets[name];
    if (!spec) {
      console.error(`Target not found in manifest: ${name}`);
      process.exit(1);
    }
    copyOneTarget(sourceRoot, name, spec);
  }
}

main();
