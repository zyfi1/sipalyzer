export type ProvisionSubviewId = "provision" | "contacts" | "device" | "diff" | "designer";

export interface ProvisionNavItem {
  id: ProvisionSubviewId;
  label: string;
}

const PROVISION_VIEWER_NAV_ITEMS: ProvisionNavItem[] = [
  { id: "provision", label: "Provision" },
  { id: "contacts", label: "Contacts" },
  { id: "device", label: "Device" },
  { id: "diff", label: "Diff" },
  { id: "designer", label: "Designer" },
];

export function getProvisionViewerNavItems(hasProvisionLoaded: boolean): ProvisionNavItem[] {
  if (hasProvisionLoaded) return PROVISION_VIEWER_NAV_ITEMS;
  return PROVISION_VIEWER_NAV_ITEMS.filter((item) => item.id !== "contacts" && item.id !== "device");
}

export function isProvisionViewerSubviewAvailable(
  subviewId: string | null | undefined,
  hasProvisionLoaded: boolean,
): subviewId is ProvisionSubviewId {
  if (!subviewId) return false;
  return getProvisionViewerNavItems(hasProvisionLoaded).some((item) => item.id === subviewId);
}
