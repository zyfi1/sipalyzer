/**
 * WeatherEffects — rich ambient canvas overlay driven by weather condition code.
 *
 * Renders a realistic day/night sky with sun/moon (accurate lunar phase),
 * twinkling stars at night, cloud layers, and weather-specific particle
 * systems (rain, snow, fog, lightning).
 */

import { useEffect, useRef, memo } from "react";
import { moonSunUnitVector } from "@/lib/moonGeometry";

type WeatherEffect = "clear" | "cloudy" | "rain" | "heavyRain" | "snow" | "thunder" | "fog" | "none";
const TARGET_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

function codeToEffect(code: number): WeatherEffect {
  if (code <= 1) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "thunder";
  if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) return "snow";
  if (code === 65 || code === 67 || code === 82) return "heavyRain";
  if (code >= 51) return "rain";
  return "cloudy";
}

// ── Particle types ───────────────────────────────────────────────

interface RainDrop {
  x: number; y: number;
  speed: number; len: number; width: number;
  opacity: number; wind: number;
  layer: number;
}

interface Splash {
  x: number; y: number;
  life: number; maxLife: number;
  radius: number; opacity: number;
}

interface Snowflake {
  x: number; y: number;
  speed: number; size: number;
  opacity: number; drift: number;
  wobbleAmp: number; wobbleFreq: number;
  phase: number; rotation: number; rotSpeed: number;
  layer: number;
}

interface FogCloud {
  x: number; y: number;
  width: number; height: number;
  speed: number; opacity: number;
  phase: number; layer: number;
}

interface LightningBolt {
  segments: { x1: number; y1: number; x2: number; y2: number; width: number }[];
  life: number; maxLife: number;
  brightness: number;
}

interface CloudPuff {
  x: number; y: number;
  width: number; height: number;
  speed: number; opacity: number;
  phase: number; layer: number;
}

interface Star {
  x: number; y: number;
  size: number; brightness: number;
  twinkleSpeed: number; phase: number;
  color: [number, number, number]; // RGB spectral color
  isConstellation: boolean;
}

interface ShootingStar {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  length: number; brightness: number;
}

interface MilkyWayNode {
  x: number; y: number;
  rx: number; ry: number;
  angle: number; opacity: number;
}

/** Same-origin (Vite `public/moon/…`) so getImageData works in Tauri/WebKit. */
const BUNDLED_MOON_TEXTURE = `${import.meta.env.BASE_URL}moon/moon-full-reference.jpg`;

/** Procedural detail map is the fallback if the photo fails to load. */
const USE_MOON_PHOTO_TEXTURE = true;

let moonTextureImage: HTMLImageElement | null = null;
let moonTextureLoading = false;

// ── State container ──────────────────────────────────────────────

interface EffectState {
  rain: RainDrop[];
  splashes: Splash[];
  snow: Snowflake[];
  fog: FogCloud[];
  lightning: LightningBolt[];
  clouds: CloudPuff[];
  stars: Star[];
  shootingStars: ShootingStar[];
  milkyWay: MilkyWayNode[];
  nextShootingStar: number;
  nextFlash: number;
  flashGlow: number;
  celestialAngle: number;
}

// ── Creators ─────────────────────────────────────────────────────

function createRain(w: number, h: number, heavy: boolean): RainDrop[] {
  const area = w * h;
  const scale = Math.max(0.3, Math.min(1, area / (900 * 300)));
  const count = Math.round((heavy ? 280 : 150) * scale);
  const drops: RainDrop[] = [];
  for (let i = 0; i < count; i++) {
    const layer = Math.random() < 0.3 ? 0 : Math.random() < 0.6 ? 1 : 2;
    const layerScale = 0.4 + layer * 0.3;
    drops.push({
      x: Math.random() * (w + 60) - 30,
      y: Math.random() * h - h,
      speed: (3.8 + Math.random() * 4.8) * layerScale * (heavy ? 1.45 : 1.12),
      len: (10 + Math.random() * 16) * layerScale,
      width: (0.5 + Math.random() * 0.8) * layerScale,
      opacity: (0.18 + Math.random() * 0.28) * layerScale,
      wind: (heavy ? 3.1 : 1.9) + Math.random() * 1.1,
      layer,
    });
  }
  return drops;
}

function createSnow(w: number, h: number): Snowflake[] {
  const area = w * h;
  const scale = Math.max(0.3, Math.min(1, area / (900 * 300)));
  const count = Math.round(70 * scale);
  const flakes: Snowflake[] = [];
  for (let i = 0; i < count; i++) {
    const layer = Math.random() < 0.3 ? 0 : Math.random() < 0.6 ? 1 : 2;
    const layerScale = 0.5 + layer * 0.25;
    flakes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      speed: (0.2 + Math.random() * 0.5) * layerScale,
      size: (1.5 + Math.random() * 3) * layerScale,
      opacity: (0.2 + Math.random() * 0.4) * layerScale,
      drift: (Math.random() - 0.5) * 0.4,
      wobbleAmp: 0.3 + Math.random() * 0.8,
      wobbleFreq: 0.001 + Math.random() * 0.002,
      phase: Math.random() * Math.PI * 2,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.02,
      layer,
    });
  }
  return flakes;
}

function createFog(w: number, h: number): FogCloud[] {
  const clouds: FogCloud[] = [];
  for (let i = 0; i < 6; i++) {
    clouds.push({
      x: Math.random() * w * 2 - w * 0.5,
      y: h * 0.3 + Math.random() * h * 0.6,
      width: w * 0.5 + Math.random() * w * 0.6,
      height: h * 0.08 + Math.random() * h * 0.16,
      speed: 0.12 + Math.random() * 0.12,
      opacity: 0.06 + Math.random() * 0.04,
      phase: Math.random() * Math.PI * 2,
      layer: 0,
    });
  }
  for (let i = 0; i < 6; i++) {
    clouds.push({
      x: Math.random() * w * 2 - w * 0.5,
      y: Math.random() * h,
      width: w * 0.12 + Math.random() * w * 0.22,
      height: h * 0.1 + Math.random() * h * 0.16,
      speed: 0.18 + Math.random() * 0.18,
      opacity: 0.04 + Math.random() * 0.04,
      phase: Math.random() * Math.PI * 2,
      layer: 1,
    });
  }
  for (let i = 0; i < 8; i++) {
    clouds.push({
      x: Math.random() * w * 2 - w * 0.5,
      y: Math.random() * h,
      width: w * 0.07 + Math.random() * w * 0.13,
      height: h * 0.03 + Math.random() * h * 0.06,
      speed: 0.3 + Math.random() * 0.35,
      opacity: 0.03 + Math.random() * 0.03,
      phase: Math.random() * Math.PI * 2,
      layer: 2,
    });
  }
  return clouds;
}

function createClouds(w: number, h: number, density: number): CloudPuff[] {
  const puffs: CloudPuff[] = [];
  if (density <= 0) return puffs;

  // Back layer — large, slow, diffuse
  const backCount = Math.round(3 + 4 * density);
  for (let i = 0; i < backCount; i++) {
    puffs.push({
      x: Math.random() * w * 2.5 - w * 0.5,
      y: Math.random() * h * 0.5,
      width: w * (0.3 + Math.random() * 0.35),
      height: h * (0.12 + Math.random() * 0.1),
      speed: 0.08 + Math.random() * 0.1,
      opacity: (0.06 + Math.random() * 0.05) * density,
      phase: Math.random() * Math.PI * 2,
      layer: 0,
    });
  }

  // Mid layer — medium sized, moderate speed
  const midCount = Math.round(4 + 5 * density);
  for (let i = 0; i < midCount; i++) {
    puffs.push({
      x: Math.random() * w * 2.5 - w * 0.5,
      y: Math.random() * h * 0.55,
      width: w * (0.15 + Math.random() * 0.25),
      height: h * (0.08 + Math.random() * 0.08),
      speed: 0.12 + Math.random() * 0.15,
      opacity: (0.08 + Math.random() * 0.06) * density,
      phase: Math.random() * Math.PI * 2,
      layer: 1,
    });
  }

  // Front layer — smaller, faster, more opaque
  const frontCount = Math.round(3 + 4 * density);
  for (let i = 0; i < frontCount; i++) {
    puffs.push({
      x: Math.random() * w * 2.5 - w * 0.5,
      y: Math.random() * h * 0.45,
      width: w * (0.1 + Math.random() * 0.18),
      height: h * (0.05 + Math.random() * 0.07),
      speed: 0.18 + Math.random() * 0.2,
      opacity: (0.1 + Math.random() * 0.08) * density,
      phase: Math.random() * Math.PI * 2,
      layer: 2,
    });
  }

  return puffs;
}

// Spectral class colors (approximate RGB)
const STAR_COLORS: [number, number, number][] = [
  [155, 175, 255], // O/B — blue-white (hot)
  [185, 200, 255], // A — white-blue
  [230, 235, 255], // F — warm white
  [255, 245, 230], // G — yellow-white (sun-like)
  [255, 220, 180], // K — orange
  [255, 190, 140], // M — red-orange (cool)
];

// Major constellation patterns — normalized [0–1] coordinates
// Each constellation is an array of [x, y, magnitude] star positions
const CONSTELLATIONS: { stars: [number, number, number][]; lines: [number, number][] }[] = [
  // Orion
  { stars: [
    [0.12, 0.15, 1.2], [0.18, 0.15, 1.0], [0.15, 0.20, 0.7],
    [0.11, 0.26, 1.1], [0.19, 0.26, 1.3], [0.13, 0.30, 0.9], [0.17, 0.30, 0.8],
  ], lines: [[0,1],[0,3],[1,4],[3,5],[4,6],[2,0],[2,1]] },
  // Big Dipper
  { stars: [
    [0.40, 0.08, 1.1], [0.44, 0.06, 1.0], [0.48, 0.07, 0.9], [0.51, 0.10, 1.0],
    [0.54, 0.13, 1.1], [0.58, 0.12, 0.8], [0.60, 0.09, 0.9],
  ], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]] },
  // Cassiopeia (W shape)
  { stars: [
    [0.70, 0.05, 1.0], [0.74, 0.10, 1.1], [0.77, 0.06, 0.9],
    [0.80, 0.11, 1.0], [0.84, 0.07, 1.1],
  ], lines: [[0,1],[1,2],[2,3],[3,4]] },
  // Leo (sickle portion)
  { stars: [
    [0.28, 0.42, 1.2], [0.25, 0.38, 0.8], [0.24, 0.34, 0.9],
    [0.26, 0.31, 0.8], [0.30, 0.33, 1.0], [0.34, 0.40, 0.9],
  ], lines: [[0,1],[1,2],[2,3],[3,4],[4,0],[0,5]] },
  // Cygnus (Northern Cross)
  { stars: [
    [0.55, 0.28, 1.1], [0.55, 0.33, 0.8], [0.55, 0.38, 1.0],
    [0.51, 0.33, 0.7], [0.59, 0.33, 0.7],
  ], lines: [[0,1],[1,2],[3,1],[1,4]] },
];

function createStars(w: number, h: number): Star[] {
  const stars: Star[] = [];

  // Constellation stars — placed at recognizable positions
  for (const constellation of CONSTELLATIONS) {
    const offsetX = (Math.random() - 0.5) * w * 0.03;
    const offsetY = (Math.random() - 0.5) * h * 0.03;
    for (const [nx, ny, mag] of constellation.stars) {
      stars.push({
        x: nx * w + offsetX,
        y: ny * h + offsetY,
        size: mag * 1.4 + 0.3,
        brightness: 0.6 + mag * 0.3,
        twinkleSpeed: 0.0008 + Math.random() * 0.001,
        phase: Math.random() * Math.PI * 2,
        color: STAR_COLORS[Math.floor(Math.random() * 3)]!,
        isConstellation: true,
      });
    }
  }

  const area = w * h;
  const starScale = Math.max(0.3, Math.min(1, area / (900 * 300)));

  // Bright field stars (magnitude 1–2 equivalent)
  const brightCount = Math.round((15 + Math.floor(Math.random() * 10)) * starScale);
  for (let i = 0; i < brightCount; i++) {
    const colorIdx = Math.random() < 0.3 ? 0 :
      Math.random() < 0.5 ? Math.floor(Math.random() * 3) :
      3 + Math.floor(Math.random() * 3);
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h * 0.75,
      size: 1.2 + Math.random() * 1.0,
      brightness: 0.5 + Math.random() * 0.5,
      twinkleSpeed: 0.001 + Math.random() * 0.002,
      phase: Math.random() * Math.PI * 2,
      color: STAR_COLORS[colorIdx]!,
      isConstellation: false,
    });
  }

  // Medium field stars
  const medCount = Math.round((60 + Math.floor(Math.random() * 30)) * starScale);
  for (let i = 0; i < medCount; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h * 0.8,
      size: 0.5 + Math.random() * 0.7,
      brightness: 0.25 + Math.random() * 0.4,
      twinkleSpeed: 0.001 + Math.random() * 0.003,
      phase: Math.random() * Math.PI * 2,
      color: STAR_COLORS[2 + Math.floor(Math.random() * 3)]!,
      isConstellation: false,
    });
  }

  // Dim background stars (dense field)
  const dimCount = Math.round((120 + Math.floor(Math.random() * 60)) * starScale);
  for (let i = 0; i < dimCount; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h * 0.85,
      size: 0.2 + Math.random() * 0.4,
      brightness: 0.08 + Math.random() * 0.2,
      twinkleSpeed: 0.002 + Math.random() * 0.004,
      phase: Math.random() * Math.PI * 2,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]!,
      isConstellation: false,
    });
  }

  return stars;
}

function createMilkyWay(w: number, h: number): MilkyWayNode[] {
  const nodes: MilkyWayNode[] = [];
  // Diagonal band from upper-left to lower-right
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const progress = i / (steps - 1);
    const baseX = w * (0.05 + progress * 0.7);
    const baseY = h * (0.0 + progress * 0.55);
    // Main band node
    nodes.push({
      x: baseX + (Math.random() - 0.5) * w * 0.08,
      y: baseY + (Math.random() - 0.5) * h * 0.06,
      rx: w * (0.06 + Math.random() * 0.05),
      ry: h * (0.03 + Math.random() * 0.025),
      angle: -0.5 + Math.random() * 0.2,
      opacity: 0.012 + Math.random() * 0.01,
    });
    // Secondary diffuse node
    if (Math.random() < 0.6) {
      nodes.push({
        x: baseX + (Math.random() - 0.5) * w * 0.12,
        y: baseY + (Math.random() - 0.5) * h * 0.08,
        rx: w * (0.04 + Math.random() * 0.04),
        ry: h * (0.02 + Math.random() * 0.02),
        angle: -0.6 + Math.random() * 0.3,
        opacity: 0.006 + Math.random() * 0.008,
      });
    }
  }
  return nodes;
}

function generateLightningBolt(w: number, h: number): LightningBolt {
  const segments: LightningBolt["segments"] = [];
  let x = w * 0.2 + Math.random() * w * 0.6;
  let y = 0;
  const targetY = h * (0.5 + Math.random() * 0.4);
  const steps = 6 + Math.floor(Math.random() * 6);
  const stepY = targetY / steps;

  for (let i = 0; i < steps; i++) {
    const nx = x + (Math.random() - 0.5) * 40;
    const ny = y + stepY + (Math.random() - 0.5) * stepY * 0.3;
    segments.push({ x1: x, y1: y, x2: nx, y2: ny, width: 2.5 - (i / steps) * 1.5 });

    if (Math.random() < 0.35 && i > 1) {
      let bx = nx, by = ny;
      const branchSteps = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < branchSteps; j++) {
        const bnx = bx + (Math.random() - 0.3) * 25;
        const bny = by + stepY * 0.4 + Math.random() * stepY * 0.3;
        segments.push({ x1: bx, y1: by, x2: bnx, y2: bny, width: 1.2 - (j / branchSteps) * 0.8 });
        bx = bnx; by = bny;
      }
    }
    x = nx; y = ny;
  }

  return { segments, life: 0, maxLife: 12 + Math.random() * 8, brightness: 0.7 + Math.random() * 0.3 };
}

// ── Celestial arc position ──────────────────────────────────────

/**
 * Compute the (x, y) position of a celestial body along a parabolic arc.
 * progress: 0 = horizon left (rise), 0.5 = peak (zenith), 1 = horizon right (set)
 */
function celestialArcPosition(
  w: number, h: number,
  progress: number,
): { x: number; y: number } {
  const margin = w * 0.12;
  const x = margin + progress * (w - margin * 2);
  // Parabolic arc: highest at 0.5, low at 0 and 1
  // Peak adapts: taller cards get higher arcs, shorter cards keep bodies visible
  const horizonY = h * 0.65;
  const peakY = h < 180 ? h * 0.18 : h * 0.12;
  const t = (progress - 0.5) * 2; // -1 to 1
  const y = peakY + (horizonY - peakY) * t * t;
  return { x, y };
}

// ── Sky & celestial draw helpers ────────────────────────────────

function drawSkyGradient(ctx: CanvasRenderingContext2D, w: number, h: number, isNight: boolean, overcast: number) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  if (isNight) {
    grad.addColorStop(0, `rgba(8, 12, 30, ${0.25 - overcast * 0.05})`);
    grad.addColorStop(0.4, `rgba(12, 18, 45, ${0.2 - overcast * 0.04})`);
    grad.addColorStop(0.8, `rgba(18, 25, 55, ${0.15 - overcast * 0.03})`);
    grad.addColorStop(1, `rgba(25, 30, 60, ${0.1 - overcast * 0.02})`);
  } else {
    const clearBoost = Math.max(0, 1 - overcast * 1.2);
    grad.addColorStop(0, `rgba(48, 122, 222, ${0.16 + clearBoost * 0.08 - overcast * 0.05})`);
    grad.addColorStop(0.32, `rgba(82, 162, 244, ${0.12 + clearBoost * 0.07 - overcast * 0.04})`);
    grad.addColorStop(0.72, `rgba(132, 198, 255, ${0.09 + clearBoost * 0.055 - overcast * 0.03})`);
    grad.addColorStop(1, `rgba(182, 224, 255, ${0.07 + clearBoost * 0.04 - overcast * 0.02})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawMilkyWay(ctx: CanvasRenderingContext2D, state: EffectState, t: number, cloudCover: number) {
  const visibility = Math.max(0, 1 - cloudCover * 2);
  if (visibility <= 0) return;

  for (const node of state.milkyWay) {
    const breathe = 0.8 + 0.2 * Math.sin(t * 0.0002 + node.angle * 5);
    const alpha = node.opacity * breathe * visibility;

    ctx.save();
    ctx.translate(node.x, node.y);
    ctx.rotate(node.angle);

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(node.rx, node.ry));
    grad.addColorStop(0, `rgba(180, 195, 230, ${alpha})`);
    grad.addColorStop(0.4, `rgba(160, 180, 220, ${alpha * 0.5})`);
    grad.addColorStop(0.7, `rgba(140, 165, 210, ${alpha * 0.2})`);
    grad.addColorStop(1, "rgba(130, 155, 200, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, node.rx, node.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawStars(ctx: CanvasRenderingContext2D, state: EffectState, w: number, h: number, t: number, cloudCover: number) {
  const visibility = Math.max(0, 1 - cloudCover * 1.5);
  if (visibility <= 0) return;

  // Draw constellation lines first (behind stars)
  let starIdx = 0;
  for (const constellation of CONSTELLATIONS) {
    const conStars = state.stars.slice(starIdx, starIdx + constellation.stars.length);
    if (conStars.length === constellation.stars.length) {
      ctx.strokeStyle = `rgba(120, 150, 200, ${0.06 * visibility})`;
      ctx.lineWidth = 0.5;
      for (const [a, b] of constellation.lines) {
        const sa = conStars[a];
        const sb = conStars[b];
        if (sa && sb) {
          ctx.beginPath();
          ctx.moveTo(sa.x, sa.y);
          ctx.lineTo(sb.x, sb.y);
          ctx.stroke();
        }
      }
    }
    starIdx += constellation.stars.length;
  }

  // Draw all stars
  for (const star of state.stars) {
    // Atmospheric scintillation — color shifts slightly
    const twinkle = 0.3 + 0.7 * Math.sin(t * star.twinkleSpeed + star.phase);
    const flicker = 0.85 + 0.15 * Math.sin(t * star.twinkleSpeed * 3.7 + star.phase * 2.1);
    const alpha = star.brightness * twinkle * flicker * visibility;

    const [r, g, b] = star.color;
    // Slight color temperature shift during twinkle
    const colorShift = Math.sin(t * star.twinkleSpeed * 2 + star.phase) * 10;
    const sr = Math.min(255, Math.max(0, r + colorShift));
    const sg = Math.min(255, Math.max(0, g));
    const sb = Math.min(255, Math.max(0, b - colorShift * 0.5));

    ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
    ctx.fill();

    // Glow halo for brighter stars
    if (star.size > 0.8) {
      const glowR = star.size * (star.isConstellation ? 4 : 3);
      const glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, glowR);
      glow.addColorStop(0, `rgba(${sr}, ${sg}, ${sb}, ${alpha * 0.25})`);
      glow.addColorStop(0.5, `rgba(${sr}, ${sg}, ${sb}, ${alpha * 0.08})`);
      glow.addColorStop(1, `rgba(${sr}, ${sg}, ${sb}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(star.x, star.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Diffraction spikes for the brightest stars
    if (star.size > 1.3 && star.brightness > 0.6) {
      const spikeLen = star.size * 3 + Math.sin(t * 0.001 + star.phase) * star.size;
      const spikeAlpha = alpha * 0.2;
      ctx.strokeStyle = `rgba(${sr}, ${sg}, ${sb}, ${spikeAlpha})`;
      ctx.lineWidth = 0.4;
      for (let a = 0; a < 4; a++) {
        const angle = (a * Math.PI) / 4 + 0.2;
        ctx.beginPath();
        ctx.moveTo(star.x - Math.cos(angle) * spikeLen, star.y - Math.sin(angle) * spikeLen);
        ctx.lineTo(star.x + Math.cos(angle) * spikeLen, star.y + Math.sin(angle) * spikeLen);
        ctx.stroke();
      }
    }
  }

  // Shooting stars
  const now = Date.now();
  if (now > state.nextShootingStar && cloudCover < 0.7) {
    const startX = Math.random() * w * 0.8 + w * 0.1;
    const startY = Math.random() * h * 0.3;
    const angle = Math.PI * 0.15 + Math.random() * Math.PI * 0.2;
    const speed = 4 + Math.random() * 6;
    state.shootingStars.push({
      x: startX, y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      maxLife: 20 + Math.random() * 25,
      length: 15 + Math.random() * 25,
      brightness: 0.5 + Math.random() * 0.5,
    });
    state.nextShootingStar = now + 4000 + Math.random() * 12000;
  }

  for (let i = state.shootingStars.length - 1; i >= 0; i--) {
    const ss = state.shootingStars[i]!;
    const progress = ss.life / ss.maxLife;

    // Fade in quickly, fade out slowly
    const fade = progress < 0.15 ? progress / 0.15 : 1 - ((progress - 0.15) / 0.85);
    const a = ss.brightness * fade * visibility;

    // Trail gradient
    const tailX = ss.x - (ss.vx / Math.sqrt(ss.vx * ss.vx + ss.vy * ss.vy)) * ss.length;
    const tailY = ss.y - (ss.vy / Math.sqrt(ss.vx * ss.vx + ss.vy * ss.vy)) * ss.length;

    const trailGrad = ctx.createLinearGradient(tailX, tailY, ss.x, ss.y);
    trailGrad.addColorStop(0, `rgba(200, 220, 255, 0)`);
    trailGrad.addColorStop(0.6, `rgba(220, 235, 255, ${a * 0.3})`);
    trailGrad.addColorStop(1, `rgba(255, 255, 255, ${a * 0.8})`);

    ctx.strokeStyle = trailGrad;
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(ss.x, ss.y);
    ctx.stroke();

    // Bright head
    const headGrad = ctx.createRadialGradient(ss.x, ss.y, 0, ss.x, ss.y, 2.5);
    headGrad.addColorStop(0, `rgba(255, 255, 255, ${a})`);
    headGrad.addColorStop(1, `rgba(200, 220, 255, 0)`);
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(ss.x, ss.y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ss.x += ss.vx;
    ss.y += ss.vy;
    ss.life++;
    if (ss.life > ss.maxLife || ss.x > w + 20 || ss.y > h + 20) {
      state.shootingStars.splice(i, 1);
    }
  }
}

function drawSun(ctx: CanvasRenderingContext2D, state: EffectState, w: number, h: number, t: number, cloudCover: number, progress: number) {
  const visibility = Math.max(0.25, 1 - cloudCover * 0.6);
  const clearBoost = Math.max(0, 1 - cloudCover * 1.25);
  const sunPresence = 1 + clearBoost * 0.38;
  const coreBoost = 1 + clearBoost * 0.52;
  // Reduce "foggy" bloom on clear days while keeping sun readability.
  const hazeFactor = 0.26 + cloudCover * 0.82;
  const { x: cx, y: cy } = celestialArcPosition(w, h, progress);
  const radius = Math.min(w, h) * 0.09;
  const R = Math.max(radius, 12);

  state.celestialAngle += 0.0003;

  // Wide warm light cast across the whole canvas
  const ambientGlow = ctx.createRadialGradient(cx, cy, R, cx, cy, R * 6.2);
  ambientGlow.addColorStop(0, `rgba(255, 210, 100, ${(0.1 + clearBoost * 0.04) * visibility * sunPresence * hazeFactor})`);
  ambientGlow.addColorStop(0.2, `rgba(255, 195, 80, ${(0.048 + clearBoost * 0.02) * visibility * sunPresence * hazeFactor})`);
  ambientGlow.addColorStop(0.5, `rgba(255, 180, 60, ${(0.018 + clearBoost * 0.008) * visibility * sunPresence * hazeFactor})`);
  ambientGlow.addColorStop(1, "rgba(255, 170, 50, 0)");
  ctx.fillStyle = ambientGlow;
  ctx.fillRect(0, 0, w, h);

  // Corona — soft outer ring
  const coronaR = R * 2.15;
  const corona = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, coronaR);
  const coronaPulse = 0.85 + 0.15 * Math.sin(t * 0.0006);
  corona.addColorStop(0, `rgba(255, 225, 140, ${(0.13 + clearBoost * 0.045) * visibility * coronaPulse * sunPresence * hazeFactor})`);
  corona.addColorStop(0.3, `rgba(255, 210, 110, ${(0.06 + clearBoost * 0.02) * visibility * coronaPulse * sunPresence * hazeFactor})`);
  corona.addColorStop(0.6, `rgba(255, 200, 90, ${(0.022 + clearBoost * 0.009) * visibility * coronaPulse * sunPresence * hazeFactor})`);
  corona.addColorStop(1, "rgba(255, 190, 70, 0)");
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(cx, cy, coronaR, 0, Math.PI * 2);
  ctx.fill();

  // Sun rays — longer, more dynamic
  const rayCount = 12;
  for (let i = 0; i < rayCount; i++) {
    const angle = state.celestialAngle + (i * Math.PI * 2) / rayCount;
    const baseLen = R * 3;
    const rayLen = baseLen + baseLen * 0.4 * Math.sin(t * 0.0008 + i * 1.1);
    const spread = 0.04 + 0.015 * Math.sin(t * 0.001 + i * 0.8);
    const rayAlpha = (0.03 + 0.015 * Math.sin(t * 0.0015 + i * 1.3)) * visibility;

    ctx.save();
    ctx.globalAlpha = rayAlpha;

    const rayGrad = ctx.createLinearGradient(cx, cy, cx + Math.cos(angle) * rayLen, cy + Math.sin(angle) * rayLen);
    rayGrad.addColorStop(0, "rgba(255, 230, 150, 1)");
    rayGrad.addColorStop(0.5, "rgba(255, 215, 120, 0.6)");
    rayGrad.addColorStop(1, "rgba(255, 200, 80, 0)");
    ctx.fillStyle = rayGrad;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle - spread) * rayLen, cy + Math.sin(angle - spread) * rayLen);
    ctx.lineTo(cx + Math.cos(angle + spread) * rayLen, cy + Math.sin(angle + spread) * rayLen);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Solid sun disc with surface gradient
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  // Core — hot white-yellow gradient
  const discGrad = ctx.createRadialGradient(cx - R * 0.15, cy - R * 0.15, 0, cx, cy, R);
  discGrad.addColorStop(0, `rgba(255, 255, 252, ${(1.0 + clearBoost * 0.1) * visibility * coreBoost})`);
  discGrad.addColorStop(0.3, `rgba(255, 248, 214, ${(0.94 + clearBoost * 0.09) * visibility * coreBoost})`);
  discGrad.addColorStop(0.6, `rgba(255, 230, 154, ${(0.84 + clearBoost * 0.08) * visibility * coreBoost})`);
  discGrad.addColorStop(0.85, `rgba(255, 204, 98, ${(0.73 + clearBoost * 0.06) * visibility * coreBoost})`);
  discGrad.addColorStop(1, `rgba(255, 178, 54, ${(0.58 + clearBoost * 0.05) * visibility * coreBoost})`);
  ctx.fillStyle = discGrad;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  // Crisp limb to keep the sun from looking misty on clear days.
  ctx.strokeStyle = `rgba(255, 246, 208, ${(0.2 + clearBoost * 0.1) * visibility})`;
  ctx.lineWidth = Math.max(0.8, R * 0.04);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.98, 0, Math.PI * 2);
  ctx.stroke();

  // Surface granulation — subtle texture spots
  const granules = [
    { dx: -0.2, dy: -0.1, r: 0.15 },
    { dx: 0.15, dy: 0.25, r: 0.12 },
    { dx: -0.3, dy: 0.2, r: 0.1 },
    { dx: 0.25, dy: -0.25, r: 0.11 },
    { dx: 0.0, dy: -0.3, r: 0.13 },
    { dx: -0.1, dy: 0.35, r: 0.09 },
    { dx: 0.3, dy: 0.05, r: 0.1 },
  ];
  for (const g of granules) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.0004 + g.dx * 10 + g.dy * 7);
    ctx.fillStyle = `rgba(255, 210, 100, ${0.06 * pulse * visibility})`;
    ctx.beginPath();
    ctx.arc(cx + g.dx * R, cy + g.dy * R, g.r * R, 0, Math.PI * 2);
    ctx.fill();
  }

  // Limb darkening — darker edge ring
  const limbGrad = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
  limbGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
  limbGrad.addColorStop(0.7, "rgba(200, 120, 20, 0)");
  limbGrad.addColorStop(1, `rgba(180, 100, 10, ${0.15 * visibility})`);
  ctx.fillStyle = limbGrad;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  ctx.restore();

  // Bright core flare on top of the disc
  const flareR = R * 0.74 + R * 0.11 * Math.sin(t * 0.001);
  const flare = ctx.createRadialGradient(cx, cy, 0, cx, cy, flareR);
  flare.addColorStop(0, `rgba(255, 255, 255, ${0.58 * visibility * coreBoost})`);
  flare.addColorStop(0.5, `rgba(255, 247, 226, ${0.24 * visibility * coreBoost})`);
  flare.addColorStop(1, "rgba(255, 240, 200, 0)");
  ctx.fillStyle = flare;
  ctx.beginPath();
  ctx.arc(cx, cy, flareR, 0, Math.PI * 2);
  ctx.fill();

  // Outer pulsing ring
  const ringAlpha = (0.028 + 0.014 * Math.sin(t * 0.0005)) * visibility;
  const ring = ctx.createRadialGradient(cx, cy, R * 1.05, cx, cy, R * 2.2);
  ring.addColorStop(0, `rgba(255, 220, 130, ${ringAlpha})`);
  ring.addColorStop(1, "rgba(255, 210, 100, 0)");
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hash2D(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const n00 = hash2D(ix, iy);
  const n10 = hash2D(ix + 1, iy);
  const n01 = hash2D(ix, iy + 1);
  const n11 = hash2D(ix + 1, iy + 1);
  const nx0 = n00 * (1 - ux) + n10 * ux;
  const nx1 = n01 * (1 - ux) + n11 * ux;
  return nx0 * (1 - uy) + nx1 * uy;
}

function fbm2D(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

interface MoonCrater {
  x: number;
  y: number;
  r: number;
  depth: number;
}

const MOON_DETAIL_MAP_SIZE = 1024;
let moonDetailMapCanvas: HTMLCanvasElement | null = null;

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function generateMoonCraterField(count: number, seed = 1337): MoonCrater[] {
  const rand = seededRandom(seed);
  const out: MoonCrater[] = [];
  let guard = 0;
  while (out.length < count && guard < count * 40) {
    guard++;
    const x = rand() * 2 - 1;
    const y = rand() * 2 - 1;
    const rr = x * x + y * y;
    if (rr > 0.95) continue;
    const edgeFalloff = Math.max(0.25, 1 - rr);
    const sizeBias = rand();
    const r = (0.012 + Math.pow(sizeBias, 2.2) * 0.06) * edgeFalloff;
    const depth = 0.07 + rand() * 0.16;
    out.push({ x, y, r, depth });
  }
  return out;
}

function getMoonDetailMapCanvas(): HTMLCanvasElement {
  if (moonDetailMapCanvas) return moonDetailMapCanvas;

  const c = document.createElement("canvas");
  c.width = MOON_DETAIL_MAP_SIZE;
  c.height = MOON_DETAIL_MAP_SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) {
    moonDetailMapCanvas = c;
    return c;
  }

  const s = MOON_DETAIL_MAP_SIZE;
  const cx = s / 2;
  const cy = s / 2;
  const R = s * 0.49;

  ctx.clearRect(0, 0, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  const base = ctx.createRadialGradient(cx - R * 0.18, cy - R * 0.18, 0, cx, cy, R);
  base.addColorStop(0, "rgba(245, 248, 252, 1)");
  base.addColorStop(0.45, "rgba(222, 230, 242, 1)");
  base.addColorStop(0.82, "rgba(188, 201, 220, 1)");
  base.addColorStop(1, "rgba(160, 176, 200, 1)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);

  // Large maria (dark basalt plains).
  const maria = [
    { x: -0.34, y: -0.22, rx: 0.22, ry: 0.16, a: 0.2 },
    { x: 0.21, y: -0.19, rx: 0.2, ry: 0.17, a: 0.18 },
    { x: 0.09, y: 0.22, rx: 0.28, ry: 0.2, a: 0.19 },
    { x: -0.31, y: 0.25, rx: 0.15, ry: 0.12, a: 0.16 },
  ];
  for (const m of maria) {
    const mx = cx + m.x * R;
    const my = cy + m.y * R;
    const grad = ctx.createRadialGradient(mx - m.rx * R * 0.2, my - m.ry * R * 0.2, 0, mx, my, Math.max(m.rx, m.ry) * R);
    grad.addColorStop(0, `rgba(118, 132, 160, ${m.a})`);
    grad.addColorStop(1, "rgba(108, 122, 150, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(mx, my, m.rx * R, m.ry * R, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // High-frequency albedo grain.
  const grain = ctx.getImageData(0, 0, s, s);
  const data = grain.data;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x + 0.5 - cx) / R;
      const dy = (y + 0.5 - cy) / R;
      const rr = dx * dx + dy * dy;
      if (rr > 1) continue;
      const i = (y * s + x) * 4;
      const n = fbm2D((dx + 1.5) * 14, (dy + 1.2) * 14, 4) - 0.5;
      const gain = 1 + n * 0.12;
      data[i] = Math.max(0, Math.min(255, Math.round((data[i] ?? 0) * gain)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round((data[i + 1] ?? 0) * gain)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round((data[i + 2] ?? 0) * gain)));
    }
  }
  ctx.putImageData(grain, 0, 0);

  // Crater field with rims and inner bowl shadow.
  const craters = generateMoonCraterField(220);
  for (const crater of craters) {
    const px = cx + crater.x * R;
    const py = cy + crater.y * R;
    const pr = crater.r * R;
    if (pr < 1.2) continue;

    const bowl = ctx.createRadialGradient(px - pr * 0.16, py - pr * 0.16, 0, px, py, pr);
    bowl.addColorStop(0, `rgba(112, 126, 154, ${crater.depth})`);
    bowl.addColorStop(0.75, `rgba(100, 115, 144, ${crater.depth * 0.5})`);
    bowl.addColorStop(1, "rgba(92, 108, 136, 0)");
    ctx.fillStyle = bowl;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();

    const rim = ctx.createRadialGradient(px + pr * 0.25, py + pr * 0.25, pr * 0.65, px, py, pr * 1.18);
    rim.addColorStop(0, "rgba(220, 229, 243, 0)");
    rim.addColorStop(1, "rgba(224, 232, 246, 0.22)");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(px, py, pr * 1.18, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  moonDetailMapCanvas = c;
  return c;
}

/** If pixel readback fails (tainted canvas etc.), draw a readable phase disc without getImageData. */
function drawMoonShadingFallback(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  sunX: number,
  sunY: number,
  _sunZ: number,
  illum: number,
  visibility: number,
) {
  void _sunZ;
  const litX = cx + sunX * R * 1.05;
  const litY = cy + sunY * R * 1.05;
  const dim = `rgba(42, 52, 72, ${0.92 * visibility})`;
  const bright = `rgba(210, 218, 238, ${0.92 * visibility})`;
  const mid = `rgba(120, 135, 168, ${0.55 * visibility})`;
  const g = ctx.createRadialGradient(litX, litY, 0, cx, cy, R * 1.02);
  g.addColorStop(0, bright);
  g.addColorStop(Math.max(0.15, 0.55 - illum * 0.35), mid);
  g.addColorStop(1, dim);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = `rgba(200, 212, 240, ${0.35 * visibility})`;
  ctx.lineWidth = Math.max(0.5, R * 0.04);
  ctx.stroke();
  ctx.restore();
}

function drawMoon(
  ctx: CanvasRenderingContext2D,
  w: number, h: number, _t: number,
  moonTexture: HTMLImageElement | null,
  moonLitFraction: number,
  moonLimbZenithRad: number,
  cloudCover: number, progress: number,
) {
  // Calibrated for unaided "natural eye" appearance, not telescope contrast.
  const naturalEyeProfile = {
    haloInner: 0.014,
    haloOuter: 0.005,
    terminatorBase: 0.038,
    terminatorRange: 0.018,
    earthshineNew: 0.28,
    earthshineBase: 0.12,
    earthshineScale: 0.12,
    surfaceGrain: 0.05,
    craterDepth: 0.04,
    shadowLift: 0.22,
    ringAlpha: 0.0028,
    edgeAlpha: 0.006,
    litBoost: 1.08,
    contrast: 1.1,
    globalGain: 0.94,
  } as const;

  const visibility = Math.max(0.25, 1 - cloudCover * 0.5);
  const { x: cx, y: cy } = celestialArcPosition(w, h, progress);
  const radius = Math.min(w, h) * 0.1;
  const R = Math.max(radius, 16);

  // Large ambient moonlight cast
  const outerGlow = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 7);
  outerGlow.addColorStop(0, `rgba(160, 185, 230, ${naturalEyeProfile.haloInner * visibility})`);
  outerGlow.addColorStop(0.3, `rgba(140, 165, 210, ${naturalEyeProfile.haloOuter * visibility})`);
  outerGlow.addColorStop(1, "rgba(120, 150, 200, 0)");
  ctx.fillStyle = outerGlow;
  ctx.fillRect(0, 0, w, h);

  // Tight halo around moon
  const haloR = R * 2.2;
  const haloGrad = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, haloR);
  haloGrad.addColorStop(0, `rgba(200, 215, 245, ${naturalEyeProfile.haloInner * visibility})`);
  haloGrad.addColorStop(0.4, `rgba(180, 200, 235, ${naturalEyeProfile.haloOuter * visibility})`);
  haloGrad.addColorStop(1, "rgba(160, 185, 225, 0)");
  ctx.fillStyle = haloGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();

  // ── Draw the lit moon disc via pixel-level phase masking ──
  // Rebuild light vector from fraction + limb here so illum and (x,y,z) never desync
  // (a desynced vector makes the disc read as “all black”).
  const illum = Math.max(0, Math.min(1, moonLitFraction));
  const limb = Number.isFinite(moonLimbZenithRad) ? moonLimbZenithRad : 0;
  const { x: sunX, y: sunY, z: sunZ } = moonSunUnitVector(illum, limb);
  const isNewMoon = illum <= 0.012;
  const isFullMoon = illum >= 0.993;

  // Solid moon back-plate so stars never bleed through the dark side.
  ctx.fillStyle = "rgba(7, 10, 20, 0.98)";
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // Physically-based per-pixel shading on a textured disc.
  // This yields a stable, high-contrast phase even with overlays/clouds.
  const detailScale = 2.2;
  const discSize = Math.max(8, Math.ceil(R * 2 * detailScale) + 4);
  const phaseCanvas = document.createElement("canvas");
  phaseCanvas.width = discSize;
  phaseCanvas.height = discSize;
  const phaseCtx = phaseCanvas.getContext("2d");

  if (phaseCtx) {
    const localCx = discSize / 2;
    const localCy = discSize / 2;
    const localR = Math.max(2, R * detailScale);

    phaseCtx.clearRect(0, 0, discSize, discSize);
    phaseCtx.save();
    phaseCtx.beginPath();
    phaseCtx.arc(localCx, localCy, localR, 0, Math.PI * 2);
    phaseCtx.clip();

    let usedTexture = false;
    if (
      USE_MOON_PHOTO_TEXTURE
      && moonTexture
      && moonTexture.complete
      && moonTexture.naturalWidth > 0
    ) {
      try {
        phaseCtx.filter = "grayscale(0.06) contrast(1.14) brightness(1.02)";
        phaseCtx.drawImage(moonTexture, 0, 0, discSize, discSize);
        phaseCtx.filter = "none";
        phaseCtx.getImageData(0, 0, 1, 1);
        usedTexture = true;
      } catch {
        usedTexture = false;
        phaseCtx.filter = "none";
      }
    }

    if (!usedTexture) {
      const detailMap = getMoonDetailMapCanvas();
      phaseCtx.globalAlpha = visibility;
      phaseCtx.drawImage(detailMap, 0, 0, discSize, discSize);
      phaseCtx.globalAlpha = 1;
    }
    phaseCtx.restore();

    try {
      const image = phaseCtx.getImageData(0, 0, discSize, discSize);
      const data = image.data;
      const terminatorSoftness =
        naturalEyeProfile.terminatorBase
        + (naturalEyeProfile.terminatorRange * (1 - Math.abs(0.5 - illum) * 2))
        + 0.012;
      const earthshine = isNewMoon
        ? naturalEyeProfile.earthshineNew
        : Math.max(naturalEyeProfile.earthshineBase, naturalEyeProfile.earthshineScale * (1 - illum));

      for (let y = 0; y < discSize; y++) {
        for (let x = 0; x < discSize; x++) {
          const i = (y * discSize + x) * 4;
          const a = data[i + 3];
          if (a === 0) continue;

          const nx = (x + 0.5 - localCx) / localR;
          const ny = (y + 0.5 - localCy) / localR;
          const rr = nx * nx + ny * ny;
          if (rr > 1) {
            data[i + 3] = 0;
            continue;
          }

          const nz = Math.sqrt(Math.max(0, 1 - rr));
          const dot = nx * sunX + ny * sunY + nz * sunZ;
          const lit = isFullMoon ? 1 : smoothstep(-terminatorSoftness, terminatorSoftness, dot);

          const limbDark = 0.82 + 0.18 * nz;
          const mariaA = Math.exp(-((nx + 0.26) ** 2 + (ny + 0.04) ** 2) / 0.085);
          const mariaB = Math.exp(-((nx - 0.18) ** 2 + (ny + 0.2) ** 2) / 0.07);
          const mariaC = Math.exp(-((nx + 0.02) ** 2 + (ny - 0.24) ** 2) / 0.06);
          const maria = Math.max(0, Math.min(1, mariaA * 0.7 + mariaB * 0.6 + mariaC * 0.5));
          const microRelief = 0.96 + 0.04 * Math.sin((nx * 16 + ny * 13) * Math.PI);

          const grain = fbm2D((nx + 1.3) * 9.5, (ny + 0.9) * 9.5, 4);
          const pits = fbm2D((nx - 0.4) * 18.0, (ny + 0.2) * 18.0, 3);
          const microCrater = Math.max(0, 0.58 - pits) * naturalEyeProfile.craterDepth;
          const highFreq = (grain - 0.5) * naturalEyeProfile.surfaceGrain - microCrater;
          const detailMix = 0.3 + lit * 0.7;
          const albedo = (1 - maria * 0.2) * microRelief * (1 + highFreq * detailMix);

          const brightness = (earthshine + (1 - earthshine) * lit) * limbDark * albedo;
          const clamped = Math.max(0, Math.min(1, brightness));
          const coolBias = 0.96 + 0.04 * (1 - lit);
          const warmLit = 0.97 + 0.03 * lit;
          const shadowLift = (1 - lit) * naturalEyeProfile.shadowLift;
          const ambientR = 104;
          const ambientG = 116;
          const ambientB = 140;
          const litExposure = 1 + lit * (naturalEyeProfile.litBoost - 1);

          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;

          const rOut = Math.max(0, Math.min(255, Math.round(r * clamped * coolBias * litExposure + ambientR * shadowLift)));
          const gOut = Math.max(0, Math.min(255, Math.round(g * clamped * litExposure + ambientG * shadowLift)));
          const bOut = Math.max(0, Math.min(255, Math.round(b * clamped * warmLit * litExposure + ambientB * shadowLift)));

          const c = naturalEyeProfile.contrast;
          data[i] = Math.max(0, Math.min(255, Math.round((((rOut / 255 - 0.5) * c + 0.5) * 255) * naturalEyeProfile.globalGain)));
          data[i + 1] = Math.max(0, Math.min(255, Math.round((((gOut / 255 - 0.5) * c + 0.5) * 255) * naturalEyeProfile.globalGain)));
          data[i + 2] = Math.max(0, Math.min(255, Math.round((((bOut / 255 - 0.5) * c + 0.5) * 255) * naturalEyeProfile.globalGain)));
        }
      }

      phaseCtx.putImageData(image, 0, 0);
      ctx.drawImage(phaseCanvas, cx - R, cy - R, R * 2, R * 2);
    } catch {
      drawMoonShadingFallback(ctx, cx, cy, R, sunX, sunY, sunZ, illum, visibility);
    }
  } else {
    drawMoonShadingFallback(ctx, cx, cy, R, sunX, sunY, sunZ, illum, visibility);
  }

  // Directional relief to make surface details readable at small size.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  const relief = ctx.createLinearGradient(cx - sunX * R, cy - sunY * R, cx + sunX * R, cy + sunY * R);
  relief.addColorStop(0, `rgba(70, 84, 116, ${0.24 * (1 - illum) * visibility})`);
  relief.addColorStop(0.45, `rgba(70, 84, 116, ${0.08 * visibility})`);
  relief.addColorStop(0.7, "rgba(255,255,255,0)");
  relief.addColorStop(1, `rgba(255,255,255, ${0.08 * illum * visibility})`);
  ctx.fillStyle = relief;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.restore();

  // Faint limb glow on lit edge.
  if (!isNewMoon) {
    const edgeX = cx + sunX * R * 0.85;
    const edgeY = cy + sunY * R * 0.85;
    const edgeGrad = ctx.createRadialGradient(edgeX, edgeY, 0, edgeX, edgeY, R * 0.6);
    const edgeAlpha = naturalEyeProfile.edgeAlpha * visibility;
    edgeGrad.addColorStop(0, `rgba(240, 245, 255, ${edgeAlpha})`);
    edgeGrad.addColorStop(1, "rgba(240, 245, 255, 0)");
    ctx.fillStyle = edgeGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Soft atmospheric bloom around moon.
  const ringAlpha = naturalEyeProfile.ringAlpha * visibility;
  const ring = ctx.createRadialGradient(cx, cy, R * 1.08, cx, cy, R * 1.8);
  ring.addColorStop(0, `rgba(210, 225, 250, ${ringAlpha})`);
  ring.addColorStop(1, "rgba(210, 225, 250, 0)");
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 2, 0, Math.PI * 2);
  ctx.fill();
}

// ── Weather draw helpers ────────────────────────────────────────

function drawRain(ctx: CanvasRenderingContext2D, state: EffectState, w: number, h: number, heavy: boolean) {
  for (const d of state.rain) {
    ctx.strokeStyle = `rgba(165, 205, 245, ${d.opacity})`;
    ctx.lineWidth = d.width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x + d.wind * 1.9, d.y + d.len);
    ctx.stroke();

    d.x += d.wind;
    d.y += d.speed;

    if (d.y > h) {
      if (d.layer >= 1 && Math.random() < (heavy ? 0.4 : 0.2)) {
        state.splashes.push({
          x: d.x, y: h - 1,
          life: 0, maxLife: 8 + Math.random() * 6,
          radius: 1.5 + Math.random() * 2,
          opacity: 0.15 + Math.random() * 0.15,
        });
      }
      d.y = -d.len - Math.random() * h * 0.3;
      d.x = Math.random() * (w + 60) - 30;
    }
  }

  for (let i = state.splashes.length - 1; i >= 0; i--) {
    const s = state.splashes[i]!;
    const progress = s.life / s.maxLife;
    const alpha = s.opacity * (1 - progress);
    const r = s.radius * (1 + progress * 3);

    ctx.strokeStyle = `rgba(160, 190, 230, ${alpha})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r, r * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();

    s.life++;
    if (s.life > s.maxLife) state.splashes.splice(i, 1);
  }

  if (heavy) {
    const mistGrad = ctx.createLinearGradient(0, h * 0.75, 0, h);
    mistGrad.addColorStop(0, "rgba(140, 165, 200, 0)");
    mistGrad.addColorStop(1, "rgba(140, 165, 200, 0.08)");
    ctx.fillStyle = mistGrad;
    ctx.fillRect(0, h * 0.75, w, h * 0.25);
  }
}

function drawSnow(ctx: CanvasRenderingContext2D, state: EffectState, w: number, h: number, t: number) {
  for (const f of state.snow) {
    const wobble = Math.sin(t * f.wobbleFreq + f.phase) * f.wobbleAmp;
    const shimmer = 0.7 + 0.3 * Math.sin(t * 0.003 + f.phase * 2);

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rotation);
    ctx.globalAlpha = f.opacity * shimmer;

    ctx.fillStyle = "rgba(210, 225, 245, 1)";
    ctx.beginPath();
    ctx.arc(0, 0, f.size, 0, Math.PI * 2);
    ctx.fill();

    if (f.size > 2.5) {
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, f.size * 2.5);
      glow.addColorStop(0, "rgba(200, 215, 240, 0.15)");
      glow.addColorStop(1, "rgba(200, 215, 240, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, f.size * 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(220, 235, 255, ${f.opacity * 0.3})`;
      ctx.lineWidth = 0.3;
      for (let a = 0; a < 6; a++) {
        const angle = (a * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle) * f.size * 1.2, Math.sin(angle) * f.size * 1.2);
        ctx.stroke();
      }
    }

    ctx.restore();

    f.x += f.drift + wobble;
    f.y += f.speed;
    f.rotation += f.rotSpeed;

    if (f.y > h + f.size) { f.y = -f.size * 2; f.x = Math.random() * w; }
    if (f.x < -20) f.x = w + 20;
    if (f.x > w + 20) f.x = -20;
  }

  const bottomGlow = ctx.createLinearGradient(0, h * 0.85, 0, h);
  bottomGlow.addColorStop(0, "rgba(200, 215, 240, 0)");
  bottomGlow.addColorStop(1, "rgba(200, 215, 240, 0.03)");
  ctx.fillStyle = bottomGlow;
  ctx.fillRect(0, h * 0.85, w, h * 0.15);
}

function drawFog(ctx: CanvasRenderingContext2D, state: EffectState, w: number, h: number, t: number) {
  const baseHaze = ctx.createLinearGradient(0, 0, 0, h);
  baseHaze.addColorStop(0, "rgba(155, 175, 205, 0.02)");
  baseHaze.addColorStop(0.4, "rgba(155, 175, 205, 0.04)");
  baseHaze.addColorStop(0.7, "rgba(155, 175, 205, 0.06)");
  baseHaze.addColorStop(1, "rgba(155, 175, 205, 0.08)");
  ctx.fillStyle = baseHaze;
  ctx.fillRect(0, 0, w, h);

  for (const c of state.fog) {
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.0005 + c.phase);
    const swell = 1 + 0.15 * Math.sin(t * 0.0003 + c.phase * 1.7);
    const vertDrift = Math.sin(t * 0.0002 + c.phase * 2.3) * 3;

    const cw = c.width * swell;
    const ch = c.height * swell;
    const cy = c.y + vertDrift;

    const grad = ctx.createRadialGradient(c.x, cy, cw * 0.05, c.x, cy, cw);
    const alpha = c.opacity * breathe;
    grad.addColorStop(0, `rgba(165, 185, 210, ${alpha})`);
    grad.addColorStop(0.3, `rgba(165, 185, 210, ${alpha * 0.7})`);
    grad.addColorStop(0.6, `rgba(165, 185, 210, ${alpha * 0.35})`);
    grad.addColorStop(1, "rgba(165, 185, 210, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(c.x, cy, cw, ch, 0, 0, Math.PI * 2);
    ctx.fill();

    c.x += c.speed;
    if (c.x - cw > w) {
      c.x = -cw;
      c.y = c.layer === 0 ? h * 0.3 + Math.random() * h * 0.6 : Math.random() * h;
    }
  }

  const waveY = h * 0.55 + Math.sin(t * 0.0002) * h * 0.1;
  const waveGrad = ctx.createLinearGradient(0, waveY - 30, 0, waveY + 30);
  waveGrad.addColorStop(0, "rgba(160, 180, 210, 0)");
  waveGrad.addColorStop(0.5, `rgba(160, 180, 210, ${0.04 + 0.02 * Math.sin(t * 0.0004)})`);
  waveGrad.addColorStop(1, "rgba(160, 180, 210, 0)");
  ctx.fillStyle = waveGrad;
  ctx.fillRect(0, waveY - 30, w, 60);
}

function drawClouds(
  ctx: CanvasRenderingContext2D,
  state: EffectState,
  w: number,
  h: number,
  t: number,
  isNight: boolean,
  layerFilter?: (layer: number) => boolean,
) {
  // Cloud colors: brighter/whiter during day, darker blue-grey at night
  const coreDay: [number, number, number] = [200, 210, 225];
  const edgeDay: [number, number, number] = [160, 175, 200];
  const coreNight: [number, number, number] = [70, 85, 110];
  const edgeNight: [number, number, number] = [50, 65, 90];
  const core = isNight ? coreNight : coreDay;
  const edge = isNight ? edgeNight : edgeDay;

  // Blob offsets for multi-puff cloud shapes (relative to cloud center)
  const blobPattern = [
    { dx: 0, dy: 0, sx: 1.0, sy: 1.0 },
    { dx: -0.3, dy: -0.05, sx: 0.7, sy: 0.75 },
    { dx: 0.35, dy: -0.08, sx: 0.65, sy: 0.7 },
    { dx: -0.15, dy: -0.2, sx: 0.55, sy: 0.6 },
    { dx: 0.18, dy: -0.18, sx: 0.5, sy: 0.55 },
    { dx: -0.45, dy: 0.05, sx: 0.45, sy: 0.5 },
    { dx: 0.5, dy: 0.03, sx: 0.4, sy: 0.45 },
  ];

  for (const c of state.clouds) {
    if (layerFilter && !layerFilter(c.layer)) continue;
    const breathe = 0.75 + 0.25 * Math.sin(t * 0.0004 + c.phase);
    const swell = 1 + 0.06 * Math.sin(t * 0.0003 + c.phase * 1.5);

    const cw = c.width * swell;
    const ch = c.height * swell;
    const centerX = c.x + cw * 0.5;
    const centerY = c.y + ch * 0.5;
    const alpha = c.opacity * breathe;

    // Draw each blob puff
    for (const blob of blobPattern) {
      const bx = centerX + blob.dx * cw;
      const by = centerY + blob.dy * ch;
      const brx = cw * 0.35 * blob.sx;
      const bry = ch * 0.5 * blob.sy;

      // Soft radial fill — core lighter, edge darker
      const grad = ctx.createRadialGradient(bx, by - bry * 0.2, brx * 0.1, bx, by, Math.max(brx, bry));
      grad.addColorStop(0, `rgba(${core[0]}, ${core[1]}, ${core[2]}, ${alpha * 0.9})`);
      grad.addColorStop(0.4, `rgba(${core[0]}, ${core[1]}, ${core[2]}, ${alpha * 0.6})`);
      grad.addColorStop(0.7, `rgba(${edge[0]}, ${edge[1]}, ${edge[2]}, ${alpha * 0.3})`);
      grad.addColorStop(1, `rgba(${edge[0]}, ${edge[1]}, ${edge[2]}, 0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(bx, by, brx, bry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Light edge highlight on top (sunlit / moonlit side)
    const highlightAlpha = alpha * (isNight ? 0.15 : 0.25);
    const hlGrad = ctx.createRadialGradient(
      centerX, centerY - ch * 0.3, cw * 0.05,
      centerX, centerY - ch * 0.15, cw * 0.3,
    );
    hlGrad.addColorStop(0, `rgba(255, 255, 255, ${highlightAlpha})`);
    hlGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = hlGrad;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY - ch * 0.2, cw * 0.3, ch * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shadow underneath
    const shadowAlpha = alpha * (isNight ? 0.2 : 0.15);
    const shGrad = ctx.createRadialGradient(
      centerX, centerY + ch * 0.3, cw * 0.05,
      centerX, centerY + ch * 0.35, cw * 0.35,
    );
    const shColor = isNight ? "60, 70, 90" : "100, 115, 140";
    shGrad.addColorStop(0, `rgba(${shColor}, ${shadowAlpha})`);
    shGrad.addColorStop(1, `rgba(${shColor}, 0)`);
    ctx.fillStyle = shGrad;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY + ch * 0.3, cw * 0.35, ch * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    c.x += c.speed;
    if (c.x > w + cw) {
      c.x = -cw * 1.5;
      c.y = Math.random() * h * 0.5;
    }
  }
}

function boostCloudMotionForStorm(state: EffectState, effect: WeatherEffect) {
  if (effect !== "rain" && effect !== "heavyRain" && effect !== "thunder") return;
  for (const c of state.clouds) {
    // Storm systems should feel active and pushed by wind.
    c.speed *= effect === "thunder" ? 1.75 : 1.45;
  }
}

function drawLightning(ctx: CanvasRenderingContext2D, state: EffectState, w: number, h: number) {
  if (state.flashGlow > 0.01) {
    ctx.fillStyle = `rgba(170, 190, 255, ${state.flashGlow * 0.06})`;
    ctx.fillRect(0, 0, w, h);
  }

  for (let i = state.lightning.length - 1; i >= 0; i--) {
    const bolt = state.lightning[i]!;
    const progress = bolt.life / bolt.maxLife;
    const fade = progress < 0.3 ? 1 : 1 - ((progress - 0.3) / 0.7);

    for (const seg of bolt.segments) {
      ctx.shadowColor = `rgba(170, 200, 255, ${fade * bolt.brightness * 0.5})`;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = `rgba(200, 220, 255, ${fade * bolt.brightness * 0.7})`;
      ctx.lineWidth = seg.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    bolt.life++;
    if (bolt.life > bolt.maxLife) state.lightning.splice(i, 1);
  }
}

// ── Main init + loop ─────────────────────────────────────────────

function cloudCoverForEffect(effect: WeatherEffect): number {
  switch (effect) {
    case "clear": return 0;
    case "cloudy": return 0.6;
    case "rain": return 0.7;
    case "heavyRain": return 0.9;
    case "thunder": return 0.95;
    case "snow": return 0.5;
    case "fog": return 0.8;
    default: return 0;
  }
}

function initState(effect: WeatherEffect, w: number, h: number, isNight: boolean): EffectState {
  const cloudCover = cloudCoverForEffect(effect);
  const nextState: EffectState = {
    rain: (effect === "rain" || effect === "heavyRain" || effect === "thunder")
      ? createRain(w, h, effect === "heavyRain" || effect === "thunder")
      : [],
    splashes: [],
    snow: effect === "snow" ? createSnow(w, h) : [],
    fog: effect === "fog" ? createFog(w, h) : [],
    lightning: [],
    clouds: createClouds(w, h, cloudCover > 0 ? cloudCover : (effect === "clear" ? 0 : 0.3)),
    stars: isNight ? createStars(w, h) : [],
    shootingStars: [],
    milkyWay: isNight ? createMilkyWay(w, h) : [],
    nextShootingStar: Date.now() + 2000 + Math.random() * 5000,
    nextFlash: effect === "thunder" ? Date.now() + 1500 + Math.random() * 3000 : Infinity,
    flashGlow: 0,
    celestialAngle: 0,
  };
  boostCloudMotionForStorm(nextState, effect);
  return nextState;
}

function tick(
  ctx: CanvasRenderingContext2D,
  effect: WeatherEffect,
  state: EffectState,
  w: number, h: number, t: number,
  isNight: boolean,
  moonLitFraction: number,
  moonLimbZenithRad: number,
  moonTexture: HTMLImageElement | null,
  celestialProgress: number,
) {
  ctx.clearRect(0, 0, w, h);

  const cloudCover = cloudCoverForEffect(effect);

  // Layer 1: Sky gradient
  drawSkyGradient(ctx, w, h, isNight, cloudCover);

  // Layer 2: Milky Way + Stars (night only, behind clouds)
  if (isNight) {
    drawMilkyWay(ctx, state, t, cloudCover);
    drawStars(ctx, state, w, h, t, cloudCover);
  }

  // Layer 3: Back/mid cloud strata
  if (state.clouds.length > 0) {
    drawClouds(ctx, state, w, h, t, isNight, (layer) => layer <= 1);
  }

  // Layer 4: Celestial body (sun or moon) — position follows an arc
  if (isNight) {
    drawMoon(ctx, w, h, t, moonTexture, moonLitFraction, moonLimbZenithRad, cloudCover, celestialProgress);
  } else {
    drawSun(ctx, state, w, h, t, cloudCover, celestialProgress);
  }

  // Layer 5: Foreground cloud strata
  if (state.clouds.length > 0) {
    drawClouds(ctx, state, w, h, t, isNight, (layer) => layer >= 2);
  }

  // Layer 6: Weather-specific effects
  switch (effect) {
    case "rain":
      drawRain(ctx, state, w, h, false);
      break;
    case "heavyRain":
      drawRain(ctx, state, w, h, true);
      break;
    case "snow":
      drawSnow(ctx, state, w, h, t);
      break;
    case "fog":
      drawFog(ctx, state, w, h, t);
      break;
    case "thunder": {
      drawRain(ctx, state, w, h, true);
      const now = Date.now();
      if (now > state.nextFlash) {
        state.lightning.push(generateLightningBolt(w, h));
        state.flashGlow = 1;
        if (Math.random() < 0.5) {
          setTimeout(() => {
            state.lightning.push(generateLightningBolt(w, h));
            state.flashGlow = Math.max(state.flashGlow, 0.7);
          }, 60 + Math.random() * 120);
        }
        state.nextFlash = now + 2500 + Math.random() * 6000;
      }
      state.flashGlow *= 0.94;
      drawLightning(ctx, state, w, h);
      break;
    }
    case "clear":
    case "cloudy":
      break;
  }
}

// ── Component ────────────────────────────────────────────────────

interface Props {
  weatherCode: number;
  isNight: boolean;
  /** Drives canvas re-init when phase name changes */
  moonPhase: string;
  moonLitFraction: number;
  moonLimbZenithRad: number;
  /** 0 = just risen, 0.5 = peak (noon/midnight), 1 = about to set */
  celestialProgress: number;
  onMoonTripleClick?: () => void;
  className?: string;
}

export const WeatherEffects = memo(function WeatherEffects({
  weatherCode,
  isNight,
  moonPhase,
  moonLitFraction,
  moonLimbZenithRad,
  celestialProgress,
  onMoonTripleClick,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const lastFrameTimeRef = useRef(0);
  const pageVisibleRef = useRef(
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );
  // Use a ref so the animation loop always reads the latest position without restarting
  const progressRef = useRef(celestialProgress);
  const moonLitFractionRef = useRef(moonLitFraction);
  const moonLimbZenithRadRef = useRef(moonLimbZenithRad);
  const onMoonTripleClickRef = useRef(onMoonTripleClick);
  const moonTextureRef = useRef<HTMLImageElement | null>(moonTextureImage);
  progressRef.current = celestialProgress;
  moonLitFractionRef.current = moonLitFraction;
  moonLimbZenithRadRef.current = moonLimbZenithRad;
  onMoonTripleClickRef.current = onMoonTripleClick;

  useEffect(() => {
    if (!USE_MOON_PHOTO_TEXTURE) return;
    if (moonTextureImage || moonTextureLoading) return;
    moonTextureLoading = true;
    const img = new Image();
    img.onload = () => {
      moonTextureImage = img;
      moonTextureRef.current = img;
      moonTextureLoading = false;
    };
    img.onerror = () => {
      moonTextureLoading = false;
    };
    img.src = BUNDLED_MOON_TEXTURE;
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      pageVisibleRef.current = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const effect = codeToEffect(weatherCode);
    if (effect === "none") return;

    let currentW = 0, currentH = 0;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return null;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      currentW = rect.width;
      currentH = rect.height;
      return { w: rect.width, h: rect.height };
    };

    const dims = resize();
    if (!dims) return;

    let state = initState(effect, dims.w, dims.h, isNight);

    const animate = (t: number) => {
      if (!pageVisibleRef.current) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }
      if (t - lastFrameTimeRef.current >= FRAME_INTERVAL_MS && currentW > 0 && currentH > 0) {
        lastFrameTimeRef.current = t;
        tick(
          ctx,
          effect,
          state,
          currentW,
          currentH,
          t,
          isNight,
          moonLitFractionRef.current,
          moonLimbZenithRadRef.current,
          moonTextureRef.current,
          progressRef.current,
        );
      }
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    const ro = new ResizeObserver(() => {
      const d = resize();
      if (d) state = initState(effect, d.w, d.h, isNight);
    });
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, [weatherCode, isNight, moonPhase]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        /* Let hero overlays (moon tooltip) receive hover; triple-click uses capture on parent. */
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
});
