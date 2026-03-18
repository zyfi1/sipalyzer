import { DnsToolView } from "./DnsToolView";

export function ProbeView({ toolId, onExecToolIdChange }: { toolId?: string; onExecToolIdChange?: (id: string) => void }) {
  return <DnsToolView toolId={toolId} onExecToolIdChange={onExecToolIdChange} />;
}
