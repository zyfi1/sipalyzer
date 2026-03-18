import { useMemo } from "react";
import packageManifest from "../../../package.json";
import cargoLockRaw from "../../../src-tauri/Cargo.lock?raw";
import agentGoModRaw from "../../../src-tauri/resources/agent-go/go.mod?raw";
import { toolRegistry } from "@/lib/toolRegistry";
import { ExternalLink, Info, Package, Shield, Sparkles, User, Wrench } from "@/lib/icons";

const FRONTEND_DEPS = [
  ...Object.entries(packageManifest.dependencies ?? {}).map(([name, version]) => ({
    name,
    version: String(version),
    scope: "runtime",
    url: `https://www.npmjs.com/package/${name}`,
  })),
  ...Object.entries(packageManifest.devDependencies ?? {}).map(([name, version]) => ({
    name,
    version: String(version),
    scope: "dev",
    url: `https://www.npmjs.com/package/${name}`,
  })),
].sort((a, b) => a.name.localeCompare(b.name));

const LICENSE_HINTS: Record<string, string> = {
  tauri: "MIT/Apache-2.0",
  tauri_build: "MIT/Apache-2.0",
  tokio: "MIT",
  serde: "MIT/Apache-2.0",
  serde_json: "MIT/Apache-2.0",
  reqwest: "MIT/Apache-2.0",
  rusqlite: "MIT",
  pcap: "MIT/Apache-2.0",
  cpal: "Apache-2.0",
  lettre: "MIT",
  rustls: "MIT/Apache-2.0/ISC",
  vosk: "Apache-2.0",
  wails: "MIT",
};

function parseCargoLock(raw: string): Array<{ name: string; version: string; license: string; url: string }> {
  const blocks = raw.split("[[package]]").slice(1);
  const seen = new Set<string>();
  const rows: Array<{ name: string; version: string; license: string; url: string }> = [];
  for (const block of blocks) {
    const name = block.match(/\nname = "([^"]+)"/)?.[1];
    const version = block.match(/\nversion = "([^"]+)"/)?.[1];
    if (!name || !version) continue;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name,
      version,
      license: LICENSE_HINTS[name] ?? "See crate metadata",
      url: `https://crates.io/crates/${name}`,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function parseGoMod(raw: string): Array<{ name: string; version: string; license: string; url: string }> {
  const rows: Array<{ name: string; version: string; license: string; url: string }> = [];
  const seen = new Set<string>();
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    if (trimmed === "require (" || trimmed === ")" || trimmed.startsWith("module ") || trimmed.startsWith("go ")) continue;
    if (!trimmed.startsWith("require ") && !/^\S+\s+v\d/.test(trimmed)) continue;
    const content = trimmed.startsWith("require ") ? trimmed.slice("require ".length).trim() : trimmed;
    const [name, version] = content.split(/\s+/);
    if (!name || !version || !version.startsWith("v")) continue;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const shortName = name.split("/").pop() ?? name;
    rows.push({
      name,
      version,
      license: LICENSE_HINTS[shortName] ?? "See module metadata",
      url: `https://${name}`,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function AdminInventoryView() {
  const toolList = useMemo(() => toolRegistry.getAll().filter((t) => !t.hidden), []);
  const cargoDeps = useMemo(() => parseCargoLock(cargoLockRaw), []);
  const goDeps = useMemo(() => parseGoMod(agentGoModRaw), []);

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
      <div className="ui-surface-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Info className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">About SIPalyzer</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          SIPalyzer is a professional VoIP diagnostics and monitoring platform built for operational troubleshooting, packet analysis, and remote agent workflows.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="rounded-md border border-border/35 bg-muted/10 px-3 py-2">
            <p className="text-2xs text-muted-foreground uppercase tracking-wide">Product</p>
            <p className="text-xs font-semibold mt-1">SIPalyzer v1.0.0</p>
            <p className="text-2xs text-muted-foreground mt-1">Built with Tauri, Rust, React, TypeScript, and Go.</p>
          </div>
          <div className="rounded-md border border-border/35 bg-muted/10 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-primary" />
              <p className="text-2xs text-muted-foreground uppercase tracking-wide">Author</p>
            </div>
            <p className="text-xs font-semibold mt-1">Michael Szymanski</p>
            <a
              href="mailto:michael@zyfi.io"
              className="text-2xs text-muted-foreground hover:text-foreground transition-smooth"
            >
              michael@zyfi.io
            </a>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-3 text-2xs text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <span>Built with the assistance of generative AI</span>
        </div>
      </div>

      <div className="ui-surface-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Wrench className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Tool Inventory</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Current tool registry with subviews, including recently added tools and sections.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {toolList.map((tool) => (
            <div key={tool.id} className="rounded-md border border-border/35 bg-muted/10 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold truncate">{tool.name}</p>
                <span className="text-2xs text-muted-foreground font-mono">{tool.id}</span>
              </div>
              {tool.subviews?.length ? (
                <p className="text-2xs text-muted-foreground mt-1">
                  {tool.subviews.map((s) => s.label).join(" · ")}
                </p>
              ) : (
                <p className="text-2xs text-muted-foreground mt-1">No subviews</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <details className="group ui-surface-card overflow-hidden" open>
        <summary className="list-none cursor-pointer px-4 py-3 border-b border-border/30 flex items-center justify-between">
          <span className="text-xs font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            Frontend Packages ({FRONTEND_DEPS.length})
          </span>
        </summary>
        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-1">
          {FRONTEND_DEPS.map((dep) => (
            <a
              key={`${dep.name}-${dep.scope}`}
              href={dep.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-muted/40 transition-smooth"
            >
              <span className="font-mono truncate">{dep.name}</span>
              <span className="text-2xs text-muted-foreground shrink-0">({dep.scope} {dep.version})</span>
              <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground/60 shrink-0" />
            </a>
          ))}
        </div>
      </details>

      <details className="group ui-surface-card overflow-hidden">
        <summary className="list-none cursor-pointer px-4 py-3 border-b border-border/30 flex items-center justify-between">
          <span className="text-xs font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Backend Crates ({cargoDeps.length})
          </span>
        </summary>
        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-1">
          {cargoDeps.map((dep) => (
            <a key={dep.name} href={dep.url} target="_blank" rel="noopener noreferrer" className="rounded px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-muted/40 transition-smooth">
              <span className="font-mono truncate">{dep.name}</span>
              <span className="text-2xs text-muted-foreground shrink-0">({dep.version})</span>
              <span className="text-2xs text-muted-foreground shrink-0">{dep.license}</span>
              <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground/60 shrink-0" />
            </a>
          ))}
        </div>
      </details>

      <details className="group ui-surface-card overflow-hidden">
        <summary className="list-none cursor-pointer px-4 py-3 border-b border-border/30 flex items-center justify-between">
          <span className="text-xs font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Remote Agent Modules ({goDeps.length})
          </span>
        </summary>
        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-1">
          {goDeps.map((dep) => (
            <a key={dep.name} href={dep.url} target="_blank" rel="noopener noreferrer" className="rounded px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-muted/40 transition-smooth">
              <span className="font-mono truncate">{dep.name}</span>
              <span className="text-2xs text-muted-foreground shrink-0">({dep.version})</span>
              <span className="text-2xs text-muted-foreground shrink-0">{dep.license}</span>
              <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground/60 shrink-0" />
            </a>
          ))}
        </div>
      </details>
    </div>
  );
}

