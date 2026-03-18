import { HOME_TOOL_ID } from "./toolRegistry";

export const TOOL_COLORS: Record<string, { icon: string }> = {
  [HOME_TOOL_ID]: { icon: "text-tool-home" },
  "packet-capture": { icon: "text-tool-capture" },
  "registration": { icon: "text-tool-registration" },
  "soft-phone": { icon: "text-tool-phone" },
  "fax-center": { icon: "text-tool-fax" },
  "provision-viewer": { icon: "text-tool-provision" },
  "network": { icon: "text-tool-network" },
  "remote-agent": { icon: "text-tool-agent" },
  "tools": { icon: "text-tool-tools" },
  "composer": { icon: "text-tool-composer" },
  "admin-center": { icon: "text-tool-monitor" },
};
