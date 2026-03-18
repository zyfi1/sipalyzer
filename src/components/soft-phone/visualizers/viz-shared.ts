/**
 * Shared constants, types, and utilities for all audio visualizers.
 *
 * Colors are resolved from the design system CSS variables at runtime
 * so the visualizers stay in sync with the app's theme.
 */

/** Parse a CSS hex color "#rrggbb" into an [R, G, B] tuple. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function cssHex(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function resolveRgb(varName: string, fallback: string): readonly [number, number, number] {
  return hexToRgb(cssHex(varName, fallback));
}

/** "You" / send / microphone channel — chart green */
export const YOU_RGB: readonly [number, number, number] = resolveRgb("--color-chart-green", "#34d399");

/** "Them" / receive / speaker channel — chart blue */
export const THEM_RGB: readonly [number, number, number] = resolveRgb("--color-chart-blue", "#60a5fa");

/** Accent shift for "You" at high energy — chart cyan */
export const YOU_ACCENT: readonly [number, number, number] = resolveRgb("--color-chart-cyan", "#22d3ee");

/** Accent shift for "Them" at high energy — chart purple */
export const THEM_ACCENT: readonly [number, number, number] = resolveRgb("--color-chart-purple", "#a78bfa");

/** Background color for visualizer canvases — terminal surface */
export const VIZ_BG = cssHex("--color-terminal-bg", "#0a0f1e");

/** Standard props every visualizer receives */
export interface VisualizerProps {
  waveformRef: React.RefObject<{ send: number[]; recv: number[] }>;
  className?: string;
  style?: React.CSSProperties;
}

/** Compute RMS energy from a sample buffer. */
export function rms(samples: number[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  const step = Math.max(1, Math.floor(samples.length / 60));
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    const s = samples[i]!;
    sum += s * s;
    count++;
  }
  return Math.sqrt(sum / count);
}

/** Linear interpolation between two scalars. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linearly interpolate between two RGB triplets. */
export function lerpRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Format an RGB triplet + alpha as a CSS rgba() string. */
export function rgba(rgb: readonly [number, number, number], a: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;
}

/** Configure canvas context for smooth, anti-aliased rendering. */
export function setupCanvas(g: CanvasRenderingContext2D): void {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
}

/** Available visualizer presets. */
export const VISUALIZER_OPTIONS = [
  { id: "nebula", label: "Particle Nebula" },
  { id: "ribbon", label: "Waveform Ribbon" },
  { id: "aurora", label: "Frequency Aurora" },
  { id: "ekg", label: "Heartbeat / EKG" },
  { id: "terrain", label: "Terrain" },
  { id: "bars", label: "Bar Spectrum" },
  { id: "rain", label: "Digital Rain" },
] as const;

export type VisualizerId = (typeof VISUALIZER_OPTIONS)[number]["id"];
