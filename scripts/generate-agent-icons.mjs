#!/usr/bin/env node
/**
 * Generate all icon sizes + .icns for the agent from the badge SVG source.
 * Uses sharp for SVG->PNG and iconutil (macOS) for .icns.
 *
 * Usage: node scripts/generate-agent-icons.mjs
 */
import sharp from "sharp";
import { execSync } from "child_process";
import { mkdirSync, readFileSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SVG_SRC = join(__dirname, "agent-icons", "agent-icon-1-badge.svg");
const ICONS_OUT = join(ROOT, "src-tauri", "resources", "agent-go");
const ICONSET_DIR = join(__dirname, "agent-icons", "agent.iconset");

// Standard macOS .icns sizes
const ICNS_SIZES = [
  { name: "icon_16x16.png", size: 16 },
  { name: "icon_16x16@2x.png", size: 32 },
  { name: "icon_32x32.png", size: 32 },
  { name: "icon_32x32@2x.png", size: 64 },
  { name: "icon_128x128.png", size: 128 },
  { name: "icon_128x128@2x.png", size: 256 },
  { name: "icon_256x256.png", size: 256 },
  { name: "icon_256x256@2x.png", size: 512 },
  { name: "icon_512x512.png", size: 512 },
  { name: "icon_512x512@2x.png", size: 1024 },
];

async function main() {
  const svg = readFileSync(SVG_SRC);

  // Create iconset directory
  if (existsSync(ICONSET_DIR)) rmSync(ICONSET_DIR, { recursive: true });
  mkdirSync(ICONSET_DIR, { recursive: true });

  console.log("Generating icon PNGs from", SVG_SRC);

  // Generate all sizes
  for (const { name, size } of ICNS_SIZES) {
    await sharp(svg, { density: Math.round((72 * size) / 1024 * 10) || 72 })
      .resize(size, size)
      .png()
      .toFile(join(ICONSET_DIR, name));
    console.log(`  ${name} (${size}x${size})`);
  }

  // Also generate a standalone 1024px icon.png
  await sharp(svg, { density: 300 })
    .resize(1024, 1024)
    .png()
    .toFile(join(ICONSET_DIR, "..", "agent-icon-1024.png"));
  console.log("  agent-icon-1024.png (1024x1024)");

  // Build .icns using iconutil
  const icnsPath = join(ICONS_OUT, "icon.icns");
  console.log("\nBuilding .icns...");
  try {
    execSync(`iconutil -c icns -o "${icnsPath}" "${ICONSET_DIR}"`, { stdio: "inherit" });
    console.log(`  -> ${icnsPath}`);
  } catch (e) {
    console.error("iconutil failed:", e.message);
    process.exit(1);
  }

  // Clean up iconset
  rmSync(ICONSET_DIR, { recursive: true });

  console.log("\nDone! Agent icon.icns written to:", icnsPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
