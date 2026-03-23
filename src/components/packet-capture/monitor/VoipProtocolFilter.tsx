import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import { Phone, Radio, FileText } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface VoipProtocolFilterProps {
  selectedProtocols: string[];
  onProtocolToggle: (protocol: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

const VOIP_PROTOCOLS = [
  { id: "SIP", name: "SIP", icon: Phone, color: "bg-primary/20 text-primary border-primary/30", tooltip: tooltips.captureProtocolSip },
  { id: "RTP", name: "RTP", icon: Radio, color: "bg-success/20 text-success border-success/30", tooltip: tooltips.captureProtocolRtp },
  { id: "RTCP", name: "RTCP", icon: Radio, color: "bg-success/20 text-success border-success/30", tooltip: tooltips.captureProtocolRtcp },
  { id: "FAX", name: "FAX/T.38", icon: FileText, color: "bg-warning/20 text-warning border-warning/30", tooltip: tooltips.captureProtocolFax },
];

export function VoipProtocolFilter({
  selectedProtocols,
  onProtocolToggle,
  onSelectAll,
  onDeselectAll,
}: VoipProtocolFilterProps) {
  const allSelected = VOIP_PROTOCOLS.every((p) => selectedProtocols.includes(p.id));

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">VoIP:</span>
      {VOIP_PROTOCOLS.map((protocol) => {
        const Icon = protocol.icon;
        const isSelected = selectedProtocols.includes(protocol.id);
        return (
          <TooltipWrapper key={protocol.id} entry={protocol.tooltip}>
            <button
              type="button"
              onClick={() => onProtocolToggle(protocol.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-2xs font-medium transition-smooth h-7",
                isSelected
                  ? `${protocol.color} border-current`
                  : "bg-card border-border hover:bg-accent"
              )}
            >
              <Icon className="h-3 w-3" />
              <span>{protocol.name}</span>
            </button>
          </TooltipWrapper>
        );
      })}
      <AppDivider orientation="vertical" size="lg" className="mx-1 h-6" />
      <TooltipWrapper entry={tooltips.captureVoipToggle}>
        <Button
          variant="ghost"
          size="sm"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="h-7 text-2xs px-2"
        >
          {allSelected ? "All Packets" : "VoIP Only"}
        </Button>
      </TooltipWrapper>
    </div>
  );
}
