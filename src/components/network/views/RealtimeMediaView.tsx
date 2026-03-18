import { useEffect } from "react";
import { MulticastView } from "@/components/network-test/views/MulticastView";

type RealtimeMediaViewProps = {
  toolId?: string;
  onExecToolIdChange?: (id: string) => void;
};

export function RealtimeMediaView({ toolId, onExecToolIdChange }: RealtimeMediaViewProps) {
  useEffect(() => {
    onExecToolIdChange?.("multicast");
  }, [onExecToolIdChange]);

  return (
    <div className="surface-flat app-view-surface-pad">
      <MulticastView toolId={toolId} />
    </div>
  );
}
