import { ToolViewShell } from "../components/ToolViewShell";
import { PortTestPanel } from "../components/PortTestPanel";
import { Shield } from "@/lib/icons";

export function PortScanView() {
  return (
    <ToolViewShell
      icon={Shield}
      tint="text-destructive"
      title="Port Scan"
      description="TCP and UDP port connectivity testing with custom profiles"
      compact
    >
      <PortTestPanel borderless />
    </ToolViewShell>
  );
}
