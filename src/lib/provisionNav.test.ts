import { describe, expect, it } from "vitest";
import { getProvisionViewerNavItems, isProvisionViewerSubviewAvailable } from "@/lib/provisionNav";

describe("provision nav visibility", () => {
  it("hides contacts and device when no provision is loaded", () => {
    const items = getProvisionViewerNavItems(false).map((item) => item.id);
    expect(items).toEqual(["provision", "firmware", "diff", "designer"]);
    expect(isProvisionViewerSubviewAvailable("contacts", false)).toBe(false);
    expect(isProvisionViewerSubviewAvailable("device", false)).toBe(false);
  });

  it("shows contacts and device when provision is loaded", () => {
    const items = getProvisionViewerNavItems(true).map((item) => item.id);
    expect(items).toEqual(["provision", "firmware", "contacts", "device", "diff", "designer"]);
    expect(isProvisionViewerSubviewAvailable("contacts", true)).toBe(true);
    expect(isProvisionViewerSubviewAvailable("device", true)).toBe(true);
  });
});
