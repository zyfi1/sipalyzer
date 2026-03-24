import { useState } from "react";
import { ChevronDown, Code, ExternalLink, FileSearch, Info, LayoutDashboard, Monitor, Network, Package, PhoneCall, Printer, Satellite, Shield, Sparkles, StickyNote, Toolbox, Wrench, X, Zap } from "@/lib/icons";
import packageManifest from "../../../package.json";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

/** Frontend dependency inventory from package manifests */
const FRONTEND_DEPS = [
  ...Object.entries(packageManifest.dependencies ?? {}).map(([name, version]) => ({
    name,
    license: `runtime ${String(version)}`,
    url: `https://www.npmjs.com/package/${name}`,
  })),
  ...Object.entries(packageManifest.devDependencies ?? {}).map(([name, version]) => ({
    name,
    license: `dev ${String(version)}`,
    url: `https://www.npmjs.com/package/${name}`,
  })),
].sort((a, b) => a.name.localeCompare(b.name));

/** Backend (Rust) dependencies with license info */
const BACKEND_DEPS = [
  { name: "tauri / tauri-build", license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/tauri" },
  { name: "tauri-plugin-shell", license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/tauri" },
  { name: "tauri-plugin-fs", license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/tauri" },
  { name: "tauri-plugin-dialog", license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/tauri" },
  { name: "tauri-plugin-updater", license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/tauri" },
  { name: "tokio", license: "MIT", url: "https://github.com/tokio-rs/tokio" },
  { name: "serde / serde_json", license: "MIT/Apache-2.0", url: "https://github.com/serde-rs/serde" },
  { name: "rusqlite (bundled-sqlcipher)", license: "MIT", url: "https://github.com/rusqlite/rusqlite" },
  { name: "reqwest (rustls/native-tls)", license: "MIT/Apache-2.0", url: "https://github.com/seanmonstar/reqwest" },
  { name: "hickory-resolver / client / proto", license: "MIT/Apache-2.0", url: "https://github.com/hickory-dns/hickory-dns" },
  { name: "rsipstack / rsip", license: "MIT", url: "https://github.com/restsend/rsipstack" },
  { name: "default-net", license: "MIT", url: "https://github.com/shellrow/default-net" },
  { name: "ipnetwork", license: "MIT/Apache-2.0", url: "https://github.com/achanda/ipnetwork" },
  { name: "ldap3", license: "MIT/Apache-2.0", url: "https://github.com/inejge/ldap3" },
  { name: "surge-ping", license: "MIT", url: "https://github.com/kolapapa/surge-ping" },
  { name: "socket2", license: "MIT/Apache-2.0", url: "https://github.com/rust-lang/socket2" },
  { name: "snmp2", license: "MIT/Apache-2.0", url: "https://github.com/roboplc/snmp2" },
  { name: "pcap / pcap-file", license: "MIT/Apache-2.0", url: "https://github.com/rust-pcap/pcap" },
  { name: "cpal", license: "Apache-2.0", url: "https://github.com/RustAudio/cpal" },
  { name: "rubato", license: "MIT", url: "https://github.com/HEnquist/rubato" },
  { name: "ezk-g711 / ezk-g722", license: "MIT/Apache-2.0", url: "https://github.com/nickelc/ezk" },
  { name: "hound", license: "Apache-2.0/MIT", url: "https://github.com/ruuda/hound" },
  { name: "image / tiff", license: "MIT/Apache-2.0", url: "https://github.com/image-rs/image" },
  { name: "printpdf", license: "MIT", url: "https://github.com/fschutt/printpdf" },
  { name: "rayon", license: "MIT/Apache-2.0", url: "https://github.com/rayon-rs/rayon" },
  { name: "crossbeam / crossbeam-channel", license: "MIT/Apache-2.0", url: "https://github.com/crossbeam-rs/crossbeam" },
  { name: "dashmap", license: "MIT", url: "https://github.com/xacrimon/dashmap" },
  { name: "parking_lot", license: "MIT/Apache-2.0", url: "https://github.com/Amanieu/parking_lot" },
  { name: "zstd", license: "MIT/BSD-3-Clause", url: "https://github.com/gyscos/zstd-rs" },
  { name: "memmap2", license: "MIT/Apache-2.0", url: "https://github.com/RazrFalcon/memmap2-rs" },
  { name: "chrono", license: "MIT/Apache-2.0", url: "https://github.com/chronotope/chrono" },
  { name: "uuid", license: "MIT/Apache-2.0", url: "https://github.com/uuid-rs/uuid" },
  { name: "anyhow / thiserror", license: "MIT/Apache-2.0", url: "https://github.com/dtolnay/anyhow" },
  { name: "sha2 / md5 / hmac / hex", license: "MIT/Apache-2.0", url: "https://github.com/RustCrypto/hashes" },
  { name: "argon2 / chacha20poly1305 / getrandom", license: "MIT/Apache-2.0", url: "https://github.com/RustCrypto/password-hashes" },
  { name: "base64", license: "MIT/Apache-2.0", url: "https://github.com/marshallpierce/rust-base64" },
  { name: "regex", license: "MIT/Apache-2.0", url: "https://github.com/rust-lang/regex" },
  { name: "once_cell", license: "MIT/Apache-2.0", url: "https://github.com/matklad/once_cell" },
  { name: "dirs", license: "MIT/Apache-2.0", url: "https://github.com/dirs-dev/dirs-rs" },
  { name: "rfd", license: "MIT", url: "https://github.com/PolyMeilex/rfd" },
  { name: "num_cpus / libc", license: "MIT/Apache-2.0", url: "https://github.com/seanmonstar/num_cpus" },
  { name: "sysinfo", license: "MIT", url: "https://github.com/GuillaumeGomez/sysinfo" },
  { name: "portable-pty", license: "MIT", url: "https://github.com/wez/wezterm" },
  { name: "russh / russh-keys", license: "Apache-2.0", url: "https://github.com/warp-tech/russh" },
  { name: "async-trait", license: "MIT/Apache-2.0", url: "https://github.com/dtolnay/async-trait" },
  { name: "tokio-tungstenite", license: "MIT", url: "https://github.com/snapview/tokio-tungstenite" },
  { name: "rustls", license: "MIT/Apache-2.0/ISC", url: "https://github.com/rustls/rustls" },
  { name: "rcgen", license: "MIT/Apache-2.0", url: "https://github.com/rustls/rcgen" },
  { name: "futures-util", license: "MIT/Apache-2.0", url: "https://github.com/rust-lang/futures-rs" },
  { name: "Vosk", license: "Apache-2.0", url: "https://github.com/alphacep/vosk-api" },
  { name: "tar / bzip2", license: "MIT/Apache-2.0", url: "https://github.com/alexcrichton/tar-rs" },
  { name: "tempfile", license: "MIT/Apache-2.0", url: "https://github.com/Stebalien/tempfile" },
  { name: "lettre", license: "MIT", url: "https://github.com/lettre/lettre" },
  { name: "tracing / tracing-subscriber", license: "MIT/Apache-2.0", url: "https://github.com/tokio-rs/tracing" },
  { name: "url (Rust)", license: "MIT/Apache-2.0", url: "https://github.com/servo/rust-url" },
  { name: "urlencoding", license: "MIT", url: "https://github.com/nickel-org/urlencoding" },
  { name: "cc", license: "MIT/Apache-2.0", url: "https://github.com/rust-lang/cc-rs" },
  { name: "bindgen", license: "BSD-3-Clause", url: "https://github.com/rust-lang/rust-bindgen" },
  { name: "SpanDSP", license: "LGPL-2.1", url: "https://github.com/freeswitch/spandsp" },
];

/** Remote Agent (Go) dependencies with license info */
const AGENT_GO_DEPS = [
  { name: "Go toolchain (bundled)", license: "BSD-3-Clause", url: "https://github.com/golang/go" },
  { name: "wails/v3 runtime", license: "MIT", url: "https://github.com/wailsapp/wails" },
  { name: "gorilla/websocket", license: "BSD-2-Clause", url: "https://github.com/gorilla/websocket" },
  { name: "miekg/dns", license: "BSD-3-Clause", url: "https://github.com/miekg/dns" },
  { name: "pion/stun", license: "MIT", url: "https://github.com/pion/stun" },
  { name: "pion/dtls", license: "MIT", url: "https://github.com/pion/dtls" },
  { name: "pion/transport", license: "MIT", url: "https://github.com/pion/transport" },
  { name: "golang.org/x/net", license: "BSD-3-Clause", url: "https://github.com/golang/net" },
  { name: "golang.org/x/sys", license: "BSD-3-Clause", url: "https://github.com/golang/sys" },
  { name: "golang.org/x/crypto", license: "BSD-3-Clause", url: "https://github.com/golang/crypto" },
  { name: "go-git / go-billy / dbus / go-webview2", license: "MIT/BSD/Apache-2.0", url: "https://github.com/go-git/go-git" },
];

const PACKET_CAPTURE_FIDELITY_HIGHLIGHTS = [
  "Raw wire-captured packet bytes are preserved (wire_captured fidelity).",
  "High-performance multi-threaded pipeline mode with tuned queues and parser threads.",
  "Ring-buffered capture and session controls designed for sustained high packet rates.",
  "Per-packet provenance and fidelity labels (authoritative, derived, simulated).",
  "Remote and scheduled capture workflows integrated into the same capture system.",
  "Native PCAP export path for Wireshark/tcpdump interoperability.",
  "Packet-fidelity guardrail tests plus command-layer Rust tests in CI.",
  "Optional differential decode checks against external tooling (when available).",
];

interface SettingsAboutPanelProps {
  onClose: () => void;
}

const APP_VERSION = packageManifest.version ?? "0.0.0";
const IS_BETA_BUILD = /beta/i.test(APP_VERSION);

export function SettingsAboutPanel({ onClose }: SettingsAboutPanelProps) {
  const [packetCaptureInfoOpen, setPacketCaptureInfoOpen] = useState(false);
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-card animate-in fade-in duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h1 className="text-lg font-semibold tracking-tight">About</h1>
        <TooltipWrapper content="Back to settings">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
            aria-label="Back to settings"
          >
            <X className="h-4 w-4" />
          </Button>
        </TooltipWrapper>
      </header>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="SIPalyzer" className="h-12 w-12 rounded-lg object-contain shrink-0 shadow-md" />
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold tracking-tight">SIPalyzer</span>
              <span className="text-2xs font-semibold px-1.5 py-0.5 rounded-full bg-accent text-foreground">v{APP_VERSION}</span>
              {IS_BETA_BUILD ? (
                <span className="text-2xs font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300">
                  Beta
                </span>
              ) : null}
            </div>
            <span className="text-sm text-muted-foreground">Professional VoIP Diagnostics & Monitoring</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            { label: "Tauri 2", Icon: Zap },
            { label: "React 18", Icon: Code },
            { label: "Rust", Icon: Shield },
            { label: "Go", Icon: Code },
            { label: "TypeScript", Icon: Code },
            { label: "Tailwind CSS", Icon: Monitor },
            { label: "Monaco Editor", Icon: Code },
            { label: "TipTap", Icon: Code },
            { label: "React Flow", Icon: Monitor },
          ] as const).map((t) => (
            <span key={t.label} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-muted-foreground bg-muted/40 rounded-lg">
              <t.Icon className="h-3 w-3 text-muted-foreground" />
              {t.label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {([
            { title: "Home", desc: "Unified dashboard with customizable widgets, root-cause analysis & support package export", Icon: LayoutDashboard },
            { title: "Packet Capture", desc: "Live monitor, capture sessions, viewer, SIP flow analysis, packet diff, remote SSH capture & scheduling", Icon: Package },
            { title: "SIP Registration", desc: "Multi-registrar health monitoring, testing & bulk operations", Icon: Shield },
            { title: "Soft Phone", desc: "Built-in SIP calling with G.711/G.722 codecs, contacts, recordings & real-time MOS scoring", Icon: PhoneCall },
            { title: "Fax Center", desc: "T.38 & G.711 fax send/receive with inbox, PDF & TIFF support", Icon: Printer },
            { title: "Device Provisioning", desc: "Provision fetch, firmware catalog, contacts, device layouts, diff, visual designer & templates", Icon: FileSearch },
            { title: "Network", desc: "Routing, connectivity, device discovery & multicast analysis", Icon: Network },
            { title: "Remote Agent", desc: "Deploy Go capture agents with WebSocket control, registry, activity & scheduled jobs", Icon: Satellite },
            { title: "Composer", desc: "HTTP/SIP request crafting, SSH terminal, in-app docs, collections & history", Icon: Wrench },
            { title: "Tools", desc: "Syslog, log viewer, file server, password generator, Text Forge & optional MCP connectors", Icon: Toolbox },
            { title: "Admin Center", desc: "Protected operational controls and administration workflows for advanced operators", Icon: Shield },
            { title: "Notes & Search", desc: "Rich notes (Markdown), tagging, folders & global command palette search", Icon: StickyNote },
          ] as const).map((f) => (
            <div key={f.title} className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/20">
              <f.Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 w-full">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-semibold text-foreground leading-tight">{f.title}</p>
                  {f.title === "Packet Capture" && (
                    <button
                      type="button"
                      aria-label="Show packet capture fidelity details"
                      aria-expanded={packetCaptureInfoOpen}
                      onClick={() => setPacketCaptureInfoOpen((v) => !v)}
                      className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-smooth"
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="text-2xs text-muted-foreground leading-snug mt-0.5">{f.desc}</p>
                {f.title === "Packet Capture" && packetCaptureInfoOpen && (
                  <div className="mt-2 rounded-md bg-muted/40 p-2">
                    <p className="text-2xs font-medium text-foreground/90">Capture fidelity & robustness</p>
                    <ul className="mt-1 list-disc pl-4 space-y-1 text-2xs text-muted-foreground">
                      {PACKET_CAPTURE_FIDELITY_HIGHLIGHTS.map((item) => (
                        <li key={item} className="leading-snug">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2.5">
          <h4 className="section-label-sm">Dependency Inventory & Open Source Licenses</h4>
          <details className="group rounded-lg shadow-card overflow-hidden">
            <summary className="px-4 py-2.5 bg-muted/30 cursor-pointer section-label hover:bg-muted/50 transition-smooth flex items-center justify-between list-none">
              <span className="flex items-center gap-2">
                Frontend (package manifests)
                <span className="text-2xs font-normal normal-case tracking-normal opacity-50">{FRONTEND_DEPS.length} packages</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {FRONTEND_DEPS.map((dep) => (
                <a key={dep.name} href={dep.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth">
                  <span className="font-mono text-xs truncate">{dep.name}</span>
                  <span className="text-2xs opacity-60 shrink-0">({dep.license})</span>
                  <ExternalLink className="h-3 w-3 opacity-30 shrink-0 ml-auto" />
                </a>
              ))}
            </div>
          </details>
          <details className="group rounded-lg shadow-card overflow-hidden">
            <summary className="px-4 py-2.5 bg-muted/30 cursor-pointer section-label hover:bg-muted/50 transition-smooth flex items-center justify-between list-none">
              <span className="flex items-center gap-2">
                Backend (Rust)
                <span className="text-2xs font-normal normal-case tracking-normal opacity-50">{BACKEND_DEPS.length} crates</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {BACKEND_DEPS.map((dep) => (
                <a key={dep.name} href={dep.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth">
                  <span className="font-mono text-xs truncate">{dep.name}</span>
                  <span className="text-2xs opacity-60 shrink-0">({dep.license})</span>
                  <ExternalLink className="h-3 w-3 opacity-30 shrink-0 ml-auto" />
                </a>
              ))}
            </div>
          </details>
          <details className="group rounded-lg shadow-card overflow-hidden">
            <summary className="px-4 py-2.5 bg-muted/30 cursor-pointer section-label hover:bg-muted/50 transition-smooth flex items-center justify-between list-none">
              <span className="flex items-center gap-2">
                Remote Agent (Go)
                <span className="text-2xs font-normal normal-case tracking-normal opacity-50">{AGENT_GO_DEPS.length} packages</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {AGENT_GO_DEPS.map((dep) => (
                <a key={dep.name} href={dep.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth">
                  <span className="font-mono text-xs truncate">{dep.name}</span>
                  <span className="text-2xs opacity-60 shrink-0">({dep.license})</span>
                  <ExternalLink className="h-3 w-3 opacity-30 shrink-0 ml-auto" />
                </a>
              ))}
            </div>
          </details>
        </div>

        <div className="flex items-center justify-center gap-1.5 pt-4">
          <Sparkles className="h-3 w-3 text-muted-foreground/60" />
          <p className="text-2xs text-muted-foreground/60">Built with the assistance of generative AI</p>
        </div>

        <div className="text-center pt-2 space-y-1.5">
          <p className="text-2xs text-muted-foreground/60">Designed &amp; developed by Michael Szymanski</p>
          <p className="text-2xs text-muted-foreground/60">
            <a href="mailto:michael@zyfi.io" className="hover:text-muted-foreground transition-smooth">michael@zyfi.io</a>
          </p>
          <p className="text-2xs text-muted-foreground/60">&copy; {new Date().getFullYear()} SIPalyzer. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
