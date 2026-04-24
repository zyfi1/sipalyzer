#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const NODE = process.execPath;

function runNodeScript(scriptName, args = []) {
  const scriptPath = join(ROOT, "scripts", scriptName);
  const result = spawnSync(NODE, [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env,
    cwd: ROOT,
  });
  return result.status ?? 1;
}

function main() {
  const validateArgs = ["--strict", "--current-host"];
  const firstPass = runNodeScript("validate-native-artifacts.mjs", validateArgs);
  if (firstPass === 0) {
    console.log("==> Native artifacts already present for current host.");
    return;
  }

  console.log("==> Missing native artifacts. Attempting automatic fetch/hydration...");

  // Preferred: prebuilt artifact bundle provided by URL/path.
  if (process.env.SIPALYZER_NATIVE_ARTIFACTS_URL) {
    const fetchStatus = runNodeScript("fetch-native-artifacts.mjs");
    if (fetchStatus !== 0) process.exit(fetchStatus);
    const hydrateStatus = runNodeScript("hydrate-native-artifacts.mjs", [
      "--source",
      join(ROOT, ".tmp", "native-artifacts"),
    ]);
    if (hydrateStatus !== 0) process.exit(hydrateStatus);
  } else {
    // Fallback: fetch from upstream package/release sources.
    const upstreamStatus = runNodeScript("fetch-native-artifacts-upstream.mjs");
    if (upstreamStatus !== 0) process.exit(upstreamStatus);
  }

  // On macOS hosts, ensure libtiff transitive dylibs are present in vendor/libs/<host>.
  const macDepsStatus = runNodeScript("sync-macos-libtiff-runtime-deps.mjs");
  if (macDepsStatus !== 0) process.exit(macDepsStatus);

  const secondPass = runNodeScript("validate-native-artifacts.mjs", validateArgs);
  if (secondPass !== 0) {
    console.error("Native artifact auto-fetch completed but validation still failed.");
    process.exit(secondPass);
  }
  console.log("==> Native artifacts ready for current host.");
}

main();
