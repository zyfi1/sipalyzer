/**
 * Raises Tailwind color opacity modifiers app-wide (less transparency).
 * Only touches /NN (0–100) and arbitrary /[0.xx] on known prefixes.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "src");
const EXT = new Set([".tsx", ".ts", ".css"]);

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXT.has(path.extname(e.name))) yield p;
  }
}

/** Bump 5–100 opacity % toward solid; leave very high values nearly unchanged */
function bumpPct(n, kind) {
  const x = parseInt(n, 10);
  if (Number.isNaN(x) || x < 0 || x > 100) return n;
  if (kind === "text") {
    if (x >= 88) return String(Math.min(100, x + 4));
    return String(Math.min(96, x + 14));
  }
  if (x >= 96) return String(Math.min(100, x + 4));
  if (x >= 90) return String(Math.min(100, x + 8));
  if (x >= 80) return "96";
  if (x >= 70) return "94";
  if (x >= 60) return "92";
  if (x >= 50) return "90";
  if (x >= 40) return "88";
  if (x >= 30) return "86";
  if (x >= 20) return "84";
  if (x >= 10) return "80";
  return "78";
}

const PREFIX =
  "\\b(bg|border|text|ring|outline|from|via|to|divide|placeholder|caret|fill|stroke|shadow)-";

// e.g. bg-background/20, border-border/35, text-primary/80
const reSlash = new RegExp(
  `${PREFIX}([\\w-]+)\\/(\\d{1,3})(?![\\d.])`,
  "g",
);

// e.g. bg-muted/[0.08]
const reArb = new RegExp(`${PREFIX}([\\w-]+)\\/\\[(\\d*\\.?\\d+)\\]`, "g");

function bumpArbDecimal(s) {
  const x = parseFloat(s);
  if (Number.isNaN(x)) return s;
  const next = Math.min(0.96, x + (x < 0.2 ? 0.18 : x < 0.45 ? 0.14 : 0.1));
  const str = next.toFixed(2).replace(/\.?0+$/, "");
  return str === "" ? "0" : str;
}

function transform(content) {
  let out = content.replace(reSlash, (full, prop, color, pct) => {
    const kind = prop === "text" || prop === "placeholder" ? "text" : "fill";
    return `${prop}-${color}/${bumpPct(pct, kind)}`;
  });
  out = out.replace(reArb, (full, prop, color, dec) => {
    return `${prop}-${color}/[${bumpArbDecimal(dec)}]`;
  });
  return out;
}

let changed = 0;
for (const file of walk(ROOT)) {
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    changed++;
  }
}
console.log(`bump-tailwind-opacity: updated ${changed} files under src/`);
