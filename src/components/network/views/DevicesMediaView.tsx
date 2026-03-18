import { useEffect, useState } from "react";
import { ToolSubTabs } from "@/components/ui/tool-sub-tabs";
import { DiscoveryView } from "@/components/network-test/views/DiscoveryView";
import { VoipView } from "@/components/network-test/VoipView";
import { MulticastView } from "@/components/network-test/views/MulticastView";

const DEVICES_MEDIA_TABS = [
  { id: "discovery", label: "Discovery" },
  { id: "voip", label: "VoIP" },
  { id: "multicast", label: "Multicast" },
] as const;

type DevicesMediaTab = (typeof DEVICES_MEDIA_TABS)[number]["id"];

interface DevicesMediaViewProps {
  toolId?: string;
  onExecToolIdChange?: (id: string) => void;
}

export function DevicesMediaView({ toolId, onExecToolIdChange }: DevicesMediaViewProps) {
  const [activeTab, setActiveTab] = useState<DevicesMediaTab>("discovery");

  useEffect(() => {
    if (activeTab === "voip") onExecToolIdChange?.("voip");
    if (activeTab === "multicast") onExecToolIdChange?.("multicast");
  }, [activeTab, onExecToolIdChange]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <ToolSubTabs
        tabs={DEVICES_MEDIA_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        toolId={toolId}
      />

      {activeTab === "discovery" && (
        <DiscoveryView toolId={toolId} onExecToolIdChange={onExecToolIdChange} />
      )}
      {activeTab === "voip" && <VoipView />}
      {activeTab === "multicast" && <MulticastView toolId={toolId} />}
    </div>
  );
}
