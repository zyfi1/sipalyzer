#!/usr/bin/env node
import { cpSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LIBS_ROOT = join(ROOT, "src-tauri", "vendor", "libs");
const TMP_ROOT = join(ROOT, ".tmp", "native-upstream");
const VOSK_VERSION = "0.3.45";
const LINUX_SPANDSP_DEB =
  "https://ftp.debian.org/debian/pool/main/s/spandsp/libspandsp2_0.0.6+dfsg-2+b1_amd64.deb";
const LINUX_TIFF_DEB =
  "https://ftp.debian.org/debian/pool/main/t/tiff/libtiff6_4.5.0-6+deb12u3_amd64.deb";
const WINDOWS_SPANDSP_PKG =
  "https://mirror.msys2.org/mingw/mingw64/mingw-w64-x86_64-spandsp-0.0.6-5-any.pkg.tar.zst";
const WINDOWS_TIFF_PKG =
  "https://mirror.msys2.org/mingw/mingw64/mingw-w64-x86_64-libtiff-4.7.1-1-any.pkg.tar.zst";

function run(command, args, cwd = ROOT) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false, cwd });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function downloadTo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${url} (${response.status})`);
  }
  await pipeline(response.body, createWriteStream(outputPath));
}

async function extractZip(archivePath, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  try {
    await run("unzip", ["-oq", archivePath, "-d", outputDir]);
  } catch {
    await run("tar", ["-xf", archivePath, "-C", outputDir]);
  }
}

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function copyMatchedFile(searchRoot, patterns, destPath) {
  const files = walkFiles(searchRoot);
  const destResolved = resolve(destPath);
  const match = files.find(
    (f) => patterns.some((p) => p.test(f.replaceAll("\\", "/"))) && resolve(f) !== destResolved,
  );
  if (!match) return false;
  try {
    if (realpathSync(match) === realpathSync(destPath)) {
      return true;
    }
  } catch {
    // Ignore realpath lookup errors for missing destination paths.
  }
  cpSync(match, destPath);
  return true;
}

function copySpandspHeaders(target) {
  const includeDir = join(LIBS_ROOT, target, "include");
  const spandspSrc = join(ROOT, "src-tauri", "vendor", "spandsp", "src");
  mkdirSync(includeDir, { recursive: true });
  const configHeader = target.includes("windows")
    ? join(spandspSrc, "msvc", "spandsp.h")
    : join(spandspSrc, "config", "spandsp.h");
  cpSync(configHeader, join(includeDir, "spandsp.h"));
  cpSync(join(spandspSrc, "spandsp"), join(includeDir, "spandsp"), { recursive: true });
}

async function extractDeb(debPath, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  await run("ar", ["x", debPath], outputDir);
  const dataArchive = walkFiles(outputDir).find((f) => /\/data\.tar\.(xz|zst|gz)$/.test(f));
  if (!dataArchive) throw new Error(`Unable to locate data archive in ${debPath}`);
  await run("tar", ["-xf", dataArchive, "-C", outputDir]);
}

async function installLinuxArtifacts() {
  const target = "x86_64-unknown-linux-gnu";
  const targetDir = join(LIBS_ROOT, target);
  mkdirSync(targetDir, { recursive: true });
  copySpandspHeaders(target);

  const spandspDeb = join(TMP_ROOT, "linux-spandsp.deb");
  const tiffDeb = join(TMP_ROOT, "linux-libtiff.deb");
  const spandspExtract = join(TMP_ROOT, "linux-spandsp-extract");
  const tiffExtract = join(TMP_ROOT, "linux-libtiff-extract");
  await downloadTo(LINUX_SPANDSP_DEB, spandspDeb);
  await downloadTo(LINUX_TIFF_DEB, tiffDeb);
  await extractDeb(spandspDeb, spandspExtract);
  await extractDeb(tiffDeb, tiffExtract);

  const hasSpandsp = copyMatchedFile(
    spandspExtract,
    [/(^|\/)libspandsp\.so(\.\d+)*$/i],
    join(targetDir, "libspandsp.so"),
  );
  const hasTiff = copyMatchedFile(
    tiffExtract,
    [/(^|\/)libtiff\.so(\.\d+)*$/i],
    join(targetDir, "libtiff.so"),
  );
  if (!hasSpandsp) throw new Error("Failed to resolve Linux libspandsp.so from Debian package");
  if (!hasTiff) throw new Error("Failed to resolve Linux libtiff.so from Debian package");

  const voskArchive = join(TMP_ROOT, "linux-vosk.zip");
  const voskExtract = join(TMP_ROOT, "linux-vosk-extract");
  await downloadTo(
    `https://github.com/alphacep/vosk-api/releases/download/v${VOSK_VERSION}/vosk-linux-x86_64-${VOSK_VERSION}.zip`,
    voskArchive,
  );
  await extractZip(voskArchive, voskExtract);
  const hasVosk = copyMatchedFile(
    voskExtract,
    [/(^|\/)libvosk\.so(\.\d+)*$/i],
    join(targetDir, "libvosk.so"),
  );
  if (!hasVosk) throw new Error("Failed to resolve Linux libvosk.so from Vosk archive");
}

async function installWindowsArtifacts() {
  const target = "x86_64-pc-windows-msvc";
  const targetDir = join(LIBS_ROOT, target);
  mkdirSync(targetDir, { recursive: true });
  copySpandspHeaders(target);

  const spandspPkg = join(TMP_ROOT, "windows-spandsp.pkg.tar.zst");
  const tiffPkg = join(TMP_ROOT, "windows-libtiff.pkg.tar.zst");
  const spandspExtract = join(TMP_ROOT, "windows-spandsp-extract");
  const tiffExtract = join(TMP_ROOT, "windows-libtiff-extract");
  await downloadTo(WINDOWS_SPANDSP_PKG, spandspPkg);
  await downloadTo(WINDOWS_TIFF_PKG, tiffPkg);
  mkdirSync(spandspExtract, { recursive: true });
  mkdirSync(tiffExtract, { recursive: true });
  await run("tar", ["-xf", spandspPkg, "-C", spandspExtract]);
  await run("tar", ["-xf", tiffPkg, "-C", tiffExtract]);

  const hasSpandsp = copyMatchedFile(
    spandspExtract,
    [/(^|\/)libspandsp-.*\.dll$/i, /(^|\/)spandsp\.dll$/i],
    join(targetDir, "spandsp.dll"),
  );
  const hasTiff = copyMatchedFile(
    tiffExtract,
    [/(^|\/)libtiff-.*\.dll$/i, /(^|\/)tiff\.dll$/i],
    join(targetDir, "tiff.dll"),
  );
  if (!hasSpandsp) throw new Error("Failed to resolve Windows spandsp.dll from MSYS2 package");
  if (!hasTiff) throw new Error("Failed to resolve Windows tiff.dll from MSYS2 package");

  const voskArchive = join(TMP_ROOT, "windows-vosk.zip");
  const voskExtract = join(TMP_ROOT, "windows-vosk-extract");
  await downloadTo(
    `https://github.com/alphacep/vosk-api/releases/download/v${VOSK_VERSION}/vosk-win64-${VOSK_VERSION}.zip`,
    voskArchive,
  );
  await extractZip(voskArchive, voskExtract);
  const hasVosk = copyMatchedFile(
    voskExtract,
    [/(^|\/)vosk\.dll$/i, /(^|\/)libvosk\.dll$/i],
    join(targetDir, "vosk.dll"),
  );
  if (!hasVosk) throw new Error("Failed to resolve Windows vosk.dll from Vosk archive");
  const hasStdCpp = copyMatchedFile(voskExtract, [/(^|\/)libstdc\+\+-6\.dll$/i], join(targetDir, "libstdc++-6.dll"));
  const hasGcc = copyMatchedFile(voskExtract, [/(^|\/)libgcc_s_seh-1\.dll$/i], join(targetDir, "libgcc_s_seh-1.dll"));
  const hasPthread = copyMatchedFile(voskExtract, [/(^|\/)libwinpthread-1\.dll$/i], join(targetDir, "libwinpthread-1.dll"));
  if (!hasStdCpp) throw new Error("Failed to resolve Windows libstdc++-6.dll from Vosk archive");
  if (!hasGcc) throw new Error("Failed to resolve Windows libgcc_s_seh-1.dll from Vosk archive");
  if (!hasPthread) throw new Error("Failed to resolve Windows libwinpthread-1.dll from Vosk archive");
}

async function main() {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });

  await installLinuxArtifacts();
  await installWindowsArtifacts();

  writeFileSync(
    join(TMP_ROOT, "SUMMARY.txt"),
    [
      "Installed upstream native artifacts:",
      "- x86_64-unknown-linux-gnu/{libspandsp.so, libtiff.so, libvosk.so}",
      "- x86_64-pc-windows-msvc/{spandsp.dll, tiff.dll, vosk.dll}",
      "",
      "Sources: Debian pool (spandsp/libtiff), MSYS2 mingw64 (spandsp/libtiff), vosk-api releases.",
    ].join("\n"),
    "utf8",
  );
  console.log("==> Upstream native artifacts installed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
