import { describe, expect, it } from "vitest";

import {
  DEFAULT_RELEASE_CHANNEL,
  coerceReleaseChannel,
  isReleaseChannel,
  RELEASE_CHANNELS,
} from "@/lib/updater/channels";

describe("release updater channels", () => {
  it("matches supported channels", () => {
    expect(RELEASE_CHANNELS).toEqual(["main", "rc", "beta"]);
  });

  it("validates channels", () => {
    expect(isReleaseChannel("beta")).toBe(true);
    expect(isReleaseChannel("rc")).toBe(true);
    expect(isReleaseChannel("main")).toBe(true);
    expect(isReleaseChannel("stable")).toBe(false);
    expect(isReleaseChannel("")).toBe(false);
  });

  it("coerces invalid values to default", () => {
    expect(coerceReleaseChannel("beta")).toBe("beta");
    expect(coerceReleaseChannel("rc")).toBe("rc");
    expect(coerceReleaseChannel("main")).toBe("main");
    expect(coerceReleaseChannel("stable")).toBe(DEFAULT_RELEASE_CHANNEL);
    expect(coerceReleaseChannel(undefined)).toBe(DEFAULT_RELEASE_CHANNEL);
    expect(coerceReleaseChannel(null)).toBe(DEFAULT_RELEASE_CHANNEL);
  });
});
