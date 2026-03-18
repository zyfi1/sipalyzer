import { DiscoveryView } from "@/components/network-test/views/DiscoveryView";

type DiscoveryWorkspaceViewProps = {
  toolId?: string;
  onExecToolIdChange?: (id: string) => void;
};

export function DiscoveryWorkspaceView({ toolId, onExecToolIdChange }: DiscoveryWorkspaceViewProps) {
  return (
    <div className="surface-flat app-view-surface-pad h-full min-h-0 flex flex-col">
      <DiscoveryView toolId={toolId} onExecToolIdChange={onExecToolIdChange} />
    </div>
  );
}
