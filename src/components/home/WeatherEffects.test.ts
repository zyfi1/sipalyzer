import { describe, expect, it } from "vitest";
import { getMoonShadowSideForPhase } from "./WeatherEffects";

describe("getMoonShadowSideForPhase", () => {
  it("keeps the dark side on the left for waxing phases", () => {
    expect(getMoonShadowSideForPhase(0.12)).toBe("left");
    expect(getMoonShadowSideForPhase(0.35)).toBe("left");
  });

  it("keeps the dark side on the right for waning phases", () => {
    expect(getMoonShadowSideForPhase(0.62)).toBe("right");
    expect(getMoonShadowSideForPhase(0.86)).toBe("right");
  });

  it("returns none at full moon", () => {
    expect(getMoonShadowSideForPhase(0.5)).toBe("none");
  });
});
