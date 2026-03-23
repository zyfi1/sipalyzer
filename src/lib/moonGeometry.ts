/**
 * Single source of truth for lunar phase + observer orientation.
 * SunCalc provides fraction/phase/limb; we turn that into one shading vector for canvas + SVG.
 */

import SunCalc from "suncalc";

const SYNODIC_MONTH_DAYS = 29.53058770576;

export type MoonObserverCoords = { lat: number; lon: number };

/** Everything the UI needs to draw the moon consistently (hero canvas + icons + tooltips). */
export interface MoonRenderModel {
  litFraction: number;
  illuminationPercent: number;
  phaseValue: number;
  phaseLabel: string;
  ageDays: number;
  waxing: boolean;
  /**
   * Limb rotation for rendering (rad): `π/2 − (angle − parallacticAngle)` in the north;
   * +π when lat < 0. 0 without observer coords.
   */
  limbZenithRad: number;
  /** Unit direction for sphere shading in WeatherEffects (x right, y down, z toward viewer). */
  sunDirection: MoonSunDirection;
  /** Same limb as canvas, for `<g transform="rotate(...)">` on the weather icon. */
  svgRotationDeg: number;
}

export interface MoonSunDirection {
  x: number;
  y: number;
  z: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function wrapAngleRad(rad: number): number {
  const twoPi = Math.PI * 2;
  let x = rad % twoPi;
  if (x < -Math.PI) x += twoPi;
  if (x > Math.PI) x -= twoPi;
  return x;
}

function normalizePhase(phase: number): number {
  return ((phase % 1) + 1) % 1;
}

/**
 * Maps lit fraction + **render limb** (rad) into the unit light vector for the pixel shader.
 * `limbRad` is the angle fed to sin/cos below (not raw SunCalc zenith — see `observerScreenLimbRad`).
 */
export function moonSunUnitVector(litFraction: number, limbRad: number): MoonSunDirection {
  const f = clamp01(litFraction);
  const z = Math.max(-1, Math.min(1, 2 * f - 1));
  const xy = Math.sqrt(Math.max(0, 1 - z * z));
  const limb = Number.isFinite(limbRad) ? limbRad : 0;
  return {
    x: Math.sin(limb) * xy,
    y: -Math.cos(limb) * xy,
    z,
  };
}

function waxingFromIllumination(illum: { angle: number; fraction: number }, phase: number): boolean {
  const f = illum.fraction;
  return f <= 0.02 ? phase < 0.5 : illum.angle < 0;
}

function phaseLabelFromValue(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return "New Moon";
  if (phase < 0.22) return "Waxing Crescent";
  if (phase < 0.28) return "First Quarter";
  if (phase < 0.47) return "Waxing Gibbous";
  if (phase < 0.53) return "Full Moon";
  if (phase < 0.72) return "Waning Gibbous";
  if (phase < 0.78) return "Last Quarter";
  return "Waning Crescent";
}

/**
 * SunCalc: `zenith = angle − parallacticAngle` is the bright limb measured **anticlockwise from zenith**
 * (README). Our shader uses polar angle in the disc plane with `sin/cos` aligned to +X / −Y.
 * Feeding `zenith` in directly pins the terminator on the vertical rim (phase looks “on the bottom”).
 * Use **π/2 − zenith** to map sky-zenith convention → canvas limb angle (same trick as common canvas demos).
 * Southern hemisphere: add π after that (disk upside-down vs NH).
 */
function observerScreenLimbRad(date: Date, lat: number, lon: number): number {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;
  const moonPos = SunCalc.getMoonPosition(date, lat, lon);
  const illum = SunCalc.getMoonIllumination(date);
  if (!Number.isFinite(illum.angle) || !Number.isFinite(moonPos.parallacticAngle)) return 0;
  const zenithAcw = illum.angle - moonPos.parallacticAngle;
  let limb = wrapAngleRad(Math.PI / 2 - zenithAcw);
  if (lat < 0) {
    limb = wrapAngleRad(limb + Math.PI);
  }
  return limb;
}

/**
 * Build the moon model for instant `date` and optional observer (weather geocode).
 * Without coords, phase/fraction are still correct; limb rotation defaults to 0.
 */
export function computeMoonRenderModel(
  date: Date,
  observer: MoonObserverCoords | null,
): MoonRenderModel {
  const illum = SunCalc.getMoonIllumination(date);
  const phaseValue = normalizePhase(illum.phase);
  const litFraction = clamp01(illum.fraction);
  const illuminationPercent = Math.round(litFraction * 100);
  const waxing = waxingFromIllumination(illum, phaseValue);

  const limbZenithRad =
    observer != null ? observerScreenLimbRad(date, observer.lat, observer.lon) : 0;

  const sunDirection = moonSunUnitVector(litFraction, limbZenithRad);

  return {
    litFraction,
    illuminationPercent,
    phaseValue,
    phaseLabel: phaseLabelFromValue(phaseValue),
    ageDays: phaseValue * SYNODIC_MONTH_DAYS,
    waxing,
    limbZenithRad,
    sunDirection,
    svgRotationDeg: (limbZenithRad * 180) / Math.PI,
  };
}

/** Simple two-disc weather icon: which side gets the dark overlay. */
export function moonIconShadowSide(fraction: number, waxing: boolean): "left" | "right" | "none" {
  const f = clamp01(fraction);
  if (f >= 0.993 || f <= 0.007) return "none";
  return waxing ? "left" : "right";
}

export { SYNODIC_MONTH_DAYS };
