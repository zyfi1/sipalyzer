/**
 * Generate app icon PNGs from SVG source, then run Tauri icon generator
 * and build a proper macOS .icns via iconutil with all Apple-template sizes.
 *
 * Usage:  node scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const svgPath = resolve(__dirname, "icon-source.svg");
const iconsDir = resolve(root, "src-tauri", "icons");
const pngPath = resolve(iconsDir, "icon.png");
const publicPngPath = resolve(root, "public", "icon.png");
const assetPngPath = resolve(root, "src", "assets", "logo.png");

const svg = readFileSync(svgPath);

/* ── 1. Render master PNGs ── */
console.log("Rendering SVG → 1024×1024 PNG ...");
await sharp(svg)
    .resize(1024, 1024)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(pngPath);
console.log(`  ✓ ${pngPath}`);

await sharp(svg).resize(1024, 1024).png().toFile(publicPngPath);
console.log(`  ✓ ${publicPngPath}`);
await sharp(svg).resize(512, 512).png().toFile(assetPngPath);
console.log(`  ✓ ${assetPngPath}`);

/* ── 2. Run Tauri icon generator (Windows, Linux, iOS, Android) ── */
console.log("\nGenerating platform icons via Tauri CLI ...");
try {
    execSync(`npx tauri icon "${pngPath}"`, {
        cwd: root,
        stdio: "inherit",
    });
    console.log("\n✓ Tauri icon generation complete.");
} catch (e) {
    console.error("Tauri icon generation failed — you may need to run it manually:");
    console.error(`  npx tauri icon "${pngPath}"`);
}

/* ── 3. Build proper macOS .icns via iconutil ── */
// Apple template sizes (macOS 11+ / Big Sur+):
//   @1x: 16, 32, 128, 256, 512
//   @2x: 32, 64, 256, 512, 1024
const ICONSET_SIZES = [
    { name: "icon_16x16.png",      size: 16   },
    { name: "icon_16x16@2x.png",   size: 32   },
    { name: "icon_32x32.png",      size: 32   },
    { name: "icon_32x32@2x.png",   size: 64   },
    { name: "icon_128x128.png",    size: 128  },
    { name: "icon_128x128@2x.png", size: 256  },
    { name: "icon_256x256.png",    size: 256  },
    { name: "icon_256x256@2x.png", size: 512  },
    { name: "icon_512x512.png",    size: 512  },
    { name: "icon_512x512@2x.png", size: 1024 },
];

const iconsetDir = resolve(iconsDir, "icon.iconset");

console.log("\nBuilding macOS .iconset ...");

// Clean & create iconset directory
if (existsSync(iconsetDir)) rmSync(iconsetDir, { recursive: true });
mkdirSync(iconsetDir, { recursive: true });

// Render each size from the SVG source (best quality — no double-resampling)
for (const { name, size } of ICONSET_SIZES) {
    const dest = resolve(iconsetDir, name);
    await sharp(svg)
        .resize(size, size, { kernel: size <= 32 ? "lanczos3" : "lanczos2" })
        .png({ compressionLevel: 9 })
        .toFile(dest);
    console.log(`  ✓ ${name} (${size}×${size})`);
}

// Convert to .icns using macOS iconutil
console.log("\nConverting .iconset → .icns via iconutil ...");
try {
    const icnsPath = resolve(iconsDir, "icon.icns");
    execSync(`iconutil -c icns -o "${icnsPath}" "${iconsetDir}"`, {
        stdio: "inherit",
    });
    console.log(`  ✓ ${icnsPath}`);
} catch (e) {
    console.error("iconutil failed — make sure you're running on macOS:");
    console.error(`  iconutil -c icns -o icon.icns "${iconsetDir}"`);
}

// Clean up the .iconset directory
rmSync(iconsetDir, { recursive: true, force: true });

console.log("\n✓ All icons generated successfully.");
