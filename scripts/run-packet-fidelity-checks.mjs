#!/usr/bin/env node
import { spawn } from "node:child_process";

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function commandExists(cmd) {
  return new Promise((resolve) => {
    const checker = process.platform === "win32" ? "where" : "which";
    const child = spawn(checker, [cmd], { stdio: "ignore", shell: false });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function main() {
  console.log("Running always-on packet verification scaffolding tests...");
  await run("cargo", [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "packet_capture::tests::",
    "--",
    "--nocapture",
  ]);

  console.log("Running packet capture command-layer tests...");
  await run("cargo", [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "commands::packet_capture::tests::",
    "--",
    "--nocapture",
  ]);

  if (process.env.SIPALYZER_ENABLE_DIFFERENTIAL_TESTS !== "1") {
    console.log(
      "Differential decode scaffold disabled (set SIPALYZER_ENABLE_DIFFERENTIAL_TESTS=1 to enable)."
    );
    return;
  }

  const hasTshark = await commandExists("tshark");
  const hasTcpdump = await commandExists("tcpdump");
  if (!hasTshark && !hasTcpdump) {
    console.log(
      "Differential decode scaffold enabled but skipped: tshark/tcpdump not found."
    );
    return;
  }

  console.log("Running env-enabled differential decode scaffold test...");
  await run("cargo", [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "packet_capture::tests::differential_decode_scaffold_is_explicitly_gated",
    "--",
    "--nocapture",
  ]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
