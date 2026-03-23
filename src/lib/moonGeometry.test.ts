import { describe, expect, it } from "vitest";
import {
  computeMoonRenderModel,
  moonIconShadowSide,
  moonSunUnitVector,
} from "./moonGeometry";

describe("moonSunUnitVector", () => {
  it("is unit length for interior fractions", () => {
    const v = moonSunUnitVector(0.5, 0.3);
    const len = Math.hypot(v.x, v.y, v.z);
    expect(len).toBeGreaterThan(0.999);
    expect(len).toBeLessThan(1.001);
  });

  it("maps full moon to +z", () => {
    const v = moonSunUnitVector(1, 1.2);
    expect(v.z).toBeCloseTo(1, 5);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(0, 5);
  });
});

describe("computeMoonRenderModel", () => {
  it("returns finite model without observer", () => {
    const m = computeMoonRenderModel(new Date("2024-06-15T12:00:00Z"), null);
    expect(m.litFraction).toBeGreaterThan(0);
    expect(m.litFraction).toBeLessThan(1);
    expect(m.limbZenithRad).toBe(0);
    expect(m.svgRotationDeg).toBe(0);
    expect(Number.isFinite(m.sunDirection.x)).toBe(true);
  });

  it("sets non-zero limb when observer is provided", () => {
    const m = computeMoonRenderModel(new Date("2024-06-15T12:00:00Z"), { lat: 51.5, lon: -0.1 });
    expect(m.limbZenithRad).not.toBe(0);
    expect(m.svgRotationDeg).not.toBe(0);
  });

  it("uses different limb rotation in northern vs southern hemisphere", () => {
    const d = new Date("2024-08-10T22:00:00Z");
    const north = computeMoonRenderModel(d, { lat: 35, lon: -84 });
    const south = computeMoonRenderModel(d, { lat: -35, lon: -84 });
    expect(Math.abs(north.limbZenithRad - south.limbZenithRad)).toBeGreaterThan(0.01);
  });
});

describe("moonIconShadowSide", () => {
  it("matches wax/wane expectations", () => {
    expect(moonIconShadowSide(0.35, true)).toBe("left");
    expect(moonIconShadowSide(0.62, false)).toBe("right");
    expect(moonIconShadowSide(0.995, true)).toBe("none");
  });
});
