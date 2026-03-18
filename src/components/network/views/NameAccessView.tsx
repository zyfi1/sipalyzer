import { ProbeView } from "@/components/network-test/views/ProbeView";

type NetworkSubviewProps = {
  toolId?: string;
  onExecToolIdChange?: (id: string) => void;
};

export function NameAccessView({ toolId, onExecToolIdChange }: NetworkSubviewProps) {
  return (
    <ProbeView toolId={toolId} onExecToolIdChange={onExecToolIdChange} />
  );
}
