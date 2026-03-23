import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ChevronDown, Info } from "@/lib/icons";
import { tooltips } from "@/lib/tooltips";
import { cn } from "@/lib/utils";
import type { PacketDiffAlignmentMode } from "./packetDiffEngine";
import {
  defaultTrafficGroupSelection,
  PACKET_TRAFFIC_GROUPS,
  type PacketTrafficGroupId,
} from "./packetDiffCategories";

export interface PacketDiffControlsProps {
  alignmentMode: PacketDiffAlignmentMode;
  onAlignmentModeChange: (mode: PacketDiffAlignmentMode) => void;
  timestampWindowMsText: string;
  onTimestampWindowMsTextChange: (value: string) => void;
  trafficGroupFilter: Set<PacketTrafficGroupId>;
  onTrafficGroupFilterChange: (next: Set<PacketTrafficGroupId>) => void;
  problemsOnly: boolean;
  onProblemsOnlyChange: (value: boolean) => void;
  hideIdleTcpAck: boolean;
  onHideIdleTcpAckChange: (value: boolean) => void;
  className?: string;
}

function isContentFamily(mode: PacketDiffAlignmentMode): boolean {
  return mode === "flow" || mode === "rtp_ssrc_seq";
}

export function PacketDiffControls({
  alignmentMode,
  onAlignmentModeChange,
  timestampWindowMsText,
  onTimestampWindowMsTextChange,
  trafficGroupFilter,
  onTrafficGroupFilterChange,
  problemsOnly,
  onProblemsOnlyChange,
  hideIdleTcpAck,
  onHideIdleTcpAckChange,
  className,
}: PacketDiffControlsProps) {
  const toggleGroup = (id: PacketTrafficGroupId, checked: boolean) => {
    const next = new Set(trafficGroupFilter);
    if (checked) {
      next.add(id);
    } else if (next.size > 1) {
      next.delete(id);
    }
    onTrafficGroupFilterChange(next);
  };

  const chipClass = (active: boolean) =>
    cn(
      "h-8 px-2.5 text-3xs rounded-md border transition-colors",
      active
        ? "border-primary/50 bg-primary text-primary-foreground shadow-sm"
        : "border-border/50 bg-background/80 text-foreground hover:bg-muted/50",
    );

  return (
    <div className={cn("px-2.5 py-2.5 border-b border-border/25 bg-muted/[0.12] space-y-3", className)}>
      <p className="text-3xs text-muted-foreground leading-relaxed max-w-[52rem]">
        Two packet lists side by side (like Wireshark + a diff). Each row is one frame from capture A paired with the
        best match on B. If rows look misaligned, switch how pairing works below.
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <div className="text-2xs font-medium text-foreground">Pair frames</div>
          <TooltipWrapper entry={tooltips.packetDiffAlignMode}>
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="How packet pairing works"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipWrapper>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <TooltipWrapper entry={tooltips.packetDiffPairingContent}>
            <button
              type="button"
              className={chipClass(isContentFamily(alignmentMode))}
              onClick={() =>
                onAlignmentModeChange(alignmentMode === "rtp_ssrc_seq" ? "rtp_ssrc_seq" : "flow")
              }
            >
              By message (default)
            </button>
          </TooltipWrapper>
          <TooltipWrapper entry={tooltips.packetDiffPairingTime}>
            <button
              type="button"
              className={chipClass(alignmentMode === "timestamp")}
              onClick={() => onAlignmentModeChange("timestamp")}
            >
              By time
            </button>
          </TooltipWrapper>
          <TooltipWrapper entry={tooltips.packetDiffPairingIndex}>
            <button
              type="button"
              className={chipClass(alignmentMode === "index")}
              onClick={() => onAlignmentModeChange("index")}
            >
              Same row #
            </button>
          </TooltipWrapper>
        </div>
        {isContentFamily(alignmentMode) ? (
          <label className="flex items-center gap-2 text-3xs text-muted-foreground cursor-pointer select-none pt-0.5">
            <Checkbox
              size="sm"
              checked={alignmentMode === "rtp_ssrc_seq"}
              onCheckedChange={(v) => onAlignmentModeChange(v === true ? "rtp_ssrc_seq" : "flow")}
            />
            <span>For RTP, match SSRC + sequence (stricter; good for media regressions)</span>
          </label>
        ) : null}
        {alignmentMode === "timestamp" ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-3xs text-muted-foreground">Within</span>
            <TooltipWrapper entry={tooltips.packetDiffTimestampWindow}>
              <Input
                type="number"
                min={0}
                value={timestampWindowMsText}
                onChange={(e) => onTimestampWindowMsTextChange(e.target.value)}
                className="h-8 w-[100px] text-3xs"
                aria-label="Timestamp pairing window in milliseconds"
              />
            </TooltipWrapper>
            <span className="text-3xs text-muted-foreground">ms — frames closer in time are paired first.</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <TooltipWrapper entry={tooltips.packetDiffMismatchesOnly}>
          <Button
            type="button"
            variant={problemsOnly ? "default" : "neutral"}
            size="sm"
            className="h-8 px-3 text-3xs"
            onClick={() => onProblemsOnlyChange(!problemsOnly)}
          >
            {problemsOnly ? "Showing: differences only" : "Showing: all rows"}
          </Button>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffHideTcpAck}>
          <Button
            type="button"
            variant={hideIdleTcpAck ? "default" : "neutral"}
            size="sm"
            className="h-8 px-3 text-3xs"
            onClick={() => onHideIdleTcpAckChange(!hideIdleTcpAck)}
          >
            {hideIdleTcpAck ? "Hiding idle TCP ACKs" : "Include all TCP"}
          </Button>
        </TooltipWrapper>
      </div>

      <details className="rounded-md border border-border/30 bg-background/40 open:pb-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-3xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          Filter which protocols appear in the list
        </summary>
        <div className="px-2 pt-1 space-y-2 border-t border-border/20">
          <div className="flex flex-wrap items-center gap-1.5">
            <TooltipWrapper entry={tooltips.packetDiffTrafficFilter}>
              <span className="text-3xs text-muted-foreground mr-1">Presets:</span>
            </TooltipWrapper>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-3xs"
              onClick={() => onTrafficGroupFilterChange(defaultTrafficGroupSelection())}
            >
              All
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-3xs"
              onClick={() => onTrafficGroupFilterChange(new Set<PacketTrafficGroupId>(["signaling"]))}
            >
              SIP
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-3xs"
              onClick={() => onTrafficGroupFilterChange(new Set<PacketTrafficGroupId>(["media", "rtcp"]))}
            >
              RTP + RTCP
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-3xs"
              onClick={() => onTrafficGroupFilterChange(new Set<PacketTrafficGroupId>(["dns", "fax"]))}
            >
              DNS + T.38
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-3xs"
              onClick={() => onTrafficGroupFilterChange(new Set<PacketTrafficGroupId>(["other"]))}
            >
              Other
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {PACKET_TRAFFIC_GROUPS.map((g) => (
              <label
                key={g.id}
                className="flex items-center gap-2 text-3xs text-foreground cursor-pointer select-none"
              >
                <Checkbox
                  size="sm"
                  checked={trafficGroupFilter.has(g.id)}
                  onCheckedChange={(v) => toggleGroup(g.id, v === true)}
                />
                {g.label}
              </label>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
