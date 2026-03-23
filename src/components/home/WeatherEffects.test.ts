import { describe, expect, it } from "vitest";
import { moonIconShadowSide } from "@/lib/moonGeometry";

describe("moonIconShadowSide (weather icon parity)", () => {
  it("puts dark overlay on the left when waxing (lit limb on the right, N. hemisphere)", () => {
    expect(moonIconShadowSide(0.35, true)).toBe("left");
    expect(moonIconShadowSide(0.12, true)).toBe("left");
  });

  it("puts dark overlay on the right when waning", () => {
    expect(moonIconShadowSide(0.62, false)).toBe("right");
    expect(moonIconShadowSide(0.86, false)).toBe("right");
  });

  it("returns none near new or full (no crescent terminator)", () => {
    expect(moonIconShadowSide(0.995, true)).toBe("none");
    expect(moonIconShadowSide(0.002, true)).toBe("none");
    expect(moonIconShadowSide(0.999, false)).toBe("none");
  });
});
