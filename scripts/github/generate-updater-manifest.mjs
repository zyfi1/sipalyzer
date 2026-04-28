#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function sanitizeVersion(tag) {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

function detectArch(assetName) {
  const lower = assetName.toLowerCase();
  if (lower.includes("aarch64") || lower.includes("arm64")) return "aarch64";
  if (lower.includes("i686")) return "i686";
  return "x86_64";
}

function classifyPlatform(assetName) {
  const lower = assetName.toLowerCase();
  if (lower.endsWith(".appimage")) {
    return `linux-${detectArch(assetName)}`;
  }
  if (lower.endsWith(".app.tar.gz")) {
    const arch = lower.includes("aarch64") || lower.includes("arm64")
      ? "aarch64"
      : (lower.includes("x86_64") || lower.includes("x64") ? "x86_64" : "aarch64");
    return `darwin-${arch}`;
  }
  if (lower.endsWith(".msi") || lower.endsWith("-setup.exe")) {
    return `windows-${detectArch(assetName)}`;
  }
  return null;
}

function platformPriority(assetName) {
  const lower = assetName.toLowerCase();
  if (lower.endsWith(".msi")) return 1;
  if (lower.endsWith("-setup.exe")) return 2;
  return 10;
}

async function ghJson(pathname, token) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${body}`);
  }
  return response.json();
}

async function fetchSignature(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/octet-stream",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to download signature (${response.status}): ${body}`);
  }
  const raw = (await response.text()).trim();
  // GitHub release assets may surface updater .sig files as a base64-encoded payload.
  // The updater expects the decoded minisign text blob.
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    if (decoded.startsWith("untrusted comment:")) {
      return decoded;
    }
  } catch {
    // Not base64-encoded; use raw string as-is.
  }
  return raw;
}

async function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo;
  const tag = args.tag;
  const channel = args.channel;
  const outPath = args.out;
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !tag || !channel || !outPath) {
    throw new Error("Usage: --repo owner/name --tag vX.Y.Z --channel beta|rc|main --out path/to/file.json");
  }
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const release = await ghJson(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, token);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (assets.length === 0) {
    throw new Error(`No assets found for release ${tag}`);
  }

  const assetsByName = new Map(assets.map((asset) => [asset.name, asset]));
  const platforms = {};

  for (const asset of assets) {
    const platform = classifyPlatform(asset.name);
    if (!platform) continue;

    const sigAsset = assetsByName.get(`${asset.name}.sig`);
    if (!sigAsset) continue;

    const existing = platforms[platform];
    if (existing && platformPriority(asset.name) >= platformPriority(existing.assetName)) {
      continue;
    }

    const signature = await fetchSignature(sigAsset.browser_download_url, token);
    platforms[platform] = {
      assetName: asset.name,
      signature,
      url: asset.browser_download_url,
    };
  }

  const platformEntries = Object.entries(platforms);
  if (platformEntries.length === 0) {
    throw new Error(`No updater-compatible assets found for ${tag}`);
  }

  const manifestPlatforms = Object.fromEntries(
    platformEntries.map(([platform, value]) => [
      platform,
      {
        signature: value.signature,
        url: value.url,
      },
    ]),
  );

  const manifest = {
    version: sanitizeVersion(tag),
    notes: release.body ?? `${channel} release ${tag}`,
    pub_date: release.published_at ?? new Date().toISOString(),
    platforms: manifestPlatforms,
  };

  const absOutPath = path.resolve(outPath);
  await mkdir(path.dirname(absOutPath), { recursive: true });
  await writeFile(absOutPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote updater manifest for ${channel} -> ${absOutPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
