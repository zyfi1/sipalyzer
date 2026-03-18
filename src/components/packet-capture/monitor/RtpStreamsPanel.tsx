import { useState, useEffect } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import type { RtpStreamInfo } from "@/types/packetCapture";
import { Radio } from "@/lib/icons";
import { IpAddress } from "@/components/ui/IpAddress";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";

interface RtpStreamsPanelProps {
  sessionId: string | null;
}

export function RtpStreamsPanel({ sessionId }: RtpStreamsPanelProps) {
  const getRtpStreams = usePacketCaptureStore((s) => s.getRtpStreams);
  const [streams, setStreams] = useState<RtpStreamInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStreams([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRtpStreams(sessionId)
      .then((list) => {
        if (!cancelled) setStreams(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Failed to load RTP streams");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, getRtpStreams]);

  if (!sessionId) {
    return (
      <EmptyState
        variant="inline"
        icon={<Radio />}
        title="Select or load a capture"
        description="Load a capture session to view RTP streams."
        className="h-full p-6"
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Spinner className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-destructive text-sm">
        {error}
      </div>
    );
  }

  if (streams.length === 0) {
    return (
      <EmptyState
        variant="inline"
        icon={<Radio />}
        title="No RTP streams found"
        description="RTP packets are detected by port and payload."
        className="h-full p-6"
      />
    );
  }

  return (
    <div className="surface-flat h-full overflow-auto p-2.5">
      <div className="ui-surface-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border/40 bg-muted/30">
            <tr>
              <th className="text-left font-medium px-3 py-2"><TooltipWrapper entry={tooltips.captureRtpSsrc}><span className="cursor-help">SSRC</span></TooltipWrapper></th>
              <th className="text-left font-medium px-3 py-2"><TooltipWrapper entry={tooltips.captureRtpCodec}><span className="cursor-help">Codec</span></TooltipWrapper></th>
              <th className="text-left font-medium px-3 py-2"><TooltipWrapper entry={tooltips.captureRtpSource}><span className="cursor-help">Source</span></TooltipWrapper></th>
              <th className="text-left font-medium px-3 py-2"><TooltipWrapper entry={tooltips.captureRtpDest}><span className="cursor-help">Destination</span></TooltipWrapper></th>
              <th className="text-right font-medium px-3 py-2"><TooltipWrapper entry={tooltips.captureRtpPackets}><span className="cursor-help">Packets</span></TooltipWrapper></th>
              <th className="text-right font-medium px-3 py-2"><TooltipWrapper entry={tooltips.captureRtpLost}><span className="cursor-help">Lost</span></TooltipWrapper></th>
              <th className="text-right font-medium px-3 py-2"><TooltipWrapper entry={tooltips.captureRtpLossPercent}><span className="cursor-help">Loss %</span></TooltipWrapper></th>
              <th className="text-right font-medium px-3 py-2"><TooltipWrapper entry={tooltips.captureRtpJitter}><span className="cursor-help">Jitter</span></TooltipWrapper></th>
              <th className="text-right font-medium px-3 py-2"><TooltipWrapper entry={tooltips.captureRtpMos}><span className="cursor-help">MOS</span></TooltipWrapper></th>
            </tr>
          </thead>
          <tbody>
            {streams.map((s) => (
              <tr key={s.ssrc} className="border-b border-border/35 hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">0x{s.ssrc.toString(16).toUpperCase().padStart(8, "0")}</td>
                <td className="px-3 py-2">{s.codecName}</td>
                <td className="px-3 py-2 text-xs"><IpAddress ip={`${s.srcIp}:${s.srcPort}`} size="sm" variant="mono" showCopyOnHover={false} /></td>
                <td className="px-3 py-2 text-xs"><IpAddress ip={`${s.dstIp}:${s.dstPort}`} size="sm" variant="mono" showCopyOnHover={false} /></td>
                <td className="px-3 py-2 text-right">{s.packetCount}</td>
                <td className="px-3 py-2 text-right">{s.lostPackets}</td>
                <td className="px-3 py-2 text-right">{s.lossPercentage.toFixed(2)}%</td>
                <td className="px-3 py-2 text-right">{s.jitter.toFixed(1)}</td>
                <td className="px-3 py-2 text-right">{s.mosScore.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
