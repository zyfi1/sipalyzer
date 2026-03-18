/**
 * Combined Stream Player — decodes two RTP streams into stereo audio
 * (caller on left channel, callee on right channel) and provides playback controls.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { invokeTauri } from "@/api/invoke";
import { Button } from "@/components/ui/button";
import { Loader2, Download } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useNotificationStore } from "@/stores/notificationStore";
import type { RtpStreamInfo } from "@/types/packetCapture";

// Inline SVG icons (shared with RtpAudioPlayer)
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function VolumeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" />
      <path d="M15.54 8.46a5 5 0 010 7.07" />
      <path d="M19.07 4.93a10 10 0 010 14.14" />
    </svg>
  );
}

function StereoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="12" r="4" />
      <circle cx="16" cy="12" r="4" />
    </svg>
  );
}

export interface CombinedStreamPlayerProps {
  sessionId: string;
  leftStream: RtpStreamInfo;
  rightStream: RtpStreamInfo;
  className?: string;
}

export function CombinedStreamPlayer({
  sessionId,
  leftStream,
  rightStream,
  className,
}: CombinedStreamPlayerProps) {
  const addNotification = useNotificationStore((s) => s.addNotification);

  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [wavBase64, setWavBase64] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [leftLabel, setLeftLabel] = useState("");
  const [rightLabel, setRightLabel] = useState("");
  const [exporting, setExporting] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Reset state when the streams change (e.g. new dialog selected)
  useEffect(() => {
    // Stop any playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setAudioUrl(null);
    setWavBase64(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLeftLabel("");
    setRightLabel("");
  }, [leftStream.ssrc, rightStream.ssrc, sessionId]);

  // Decode the combined stereo stream
  const handleDecode = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invokeTauri<{
        wavBase64: string;
        durationSec: number;
        leftLabel: string;
        rightLabel: string;
      }>("rtp_streams_decode_combined", {
        sessionId,
        ssrcLeft: leftStream.ssrc,
        ssrcRight: rightStream.ssrc,
      });
      const url = `data:audio/wav;base64,${result.wavBase64}`;
      setAudioUrl(url);
      setWavBase64(result.wavBase64);
      setDuration(result.durationSec);
      setLeftLabel(result.leftLabel);
      setRightLabel(result.rightLabel);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addNotification({
        type: "error",
        title: "Stereo Decode Failed",
        description: msg,
        source: "packet-capture",
      });
    } finally {
      setLoading(false);
    }
  }, [sessionId, leftStream.ssrc, rightStream.ssrc, addNotification]);

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying(!playing);
  }, [playing]);

  // Handle seek
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  // Handle volume change
  const handleVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  }, []);

  // Update current time during playback
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onLoadedMetadata = () => setDuration(audio.duration);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [audioUrl]);

  // Export stereo WAV via save dialog
  const handleExport = useCallback(async () => {
    if (!wavBase64) return;
    setExporting(true);
    try {
      await invokeTauri<string>("save_export_file", {
        defaultName: `combined_${leftStream.ssrc}_${rightStream.ssrc}.wav`,
        contentBase64: wavBase64,
        filterName: "WAV audio",
        extension: "wav",
      });
      addNotification({
        type: "success",
        title: "Stereo WAV Exported",
        description: "Combined stereo audio saved successfully.",
        source: "packet-capture",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("cancelled")) {
        addNotification({
          type: "error",
          title: "WAV Export Failed",
          description: msg,
          source: "packet-capture",
        });
      }
    } finally {
      setExporting(false);
    }
  }, [wavBase64, leftStream.ssrc, rightStream.ssrc, addNotification]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const leftEndpoint = `${leftStream.srcIp}:${leftStream.srcPort}`;
  const rightEndpoint = `${rightStream.srcIp}:${rightStream.srcPort}`;

  return (
    <div
      className={cn(
        "surface p-3 space-y-2.5",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <StereoIcon className="h-3.5 w-3.5 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground truncate">Combined Stream Audio (Stereo)</p>
            <p className="text-3xs text-muted-foreground/75 truncate">Selected stream pair</p>
          </div>
        </div>
        {!audioUrl && (
          <TooltipWrapper content="Decode audio for the selected stream pair">
            <Button
              size="sm"
              variant="neutral"
              className="h-7 text-2xs shrink-0 px-2.5"
              onClick={handleDecode}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <PlayIcon className="h-3 w-3 mr-1" />
              )}
              {loading ? "Decoding..." : "Decode Pair"}
            </Button>
          </TooltipWrapper>
        )}
      </div>

      {/* Channel labels (always visible) */}
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
        <div className="rounded-md border border-info/30 bg-info/10 px-2 py-1.5 min-w-0">
          <p className="text-3xs uppercase tracking-[0.08em] text-info font-semibold">Left Channel</p>
          <p className="font-mono text-2xs text-info/85 truncate">{audioUrl && leftLabel ? leftLabel : leftEndpoint}</p>
        </div>
        <div className="rounded-md border border-success/30 bg-success/10 px-2 py-1.5 min-w-0">
          <p className="text-3xs uppercase tracking-[0.08em] text-success font-semibold">Right Channel</p>
          <p className="font-mono text-2xs text-success/85 truncate">{audioUrl && rightLabel ? rightLabel : rightEndpoint}</p>
        </div>
      </div>

      {audioUrl && (
        <>
          <audio ref={audioRef} src={audioUrl} preload="auto" />

          {/* Controls */}
          <div className="rounded-md border border-border/40 bg-[hsl(var(--background)/0.45)] px-2 py-1.5 flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="ui-control-shell h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-smooth"
            >
              {playing ? (
                <PauseIcon className="h-3 w-3" />
              ) : (
                <PlayIcon className="h-3 w-3 ml-0.5" />
              )}
            </button>

            {/* Seek bar */}
            <span className="text-2xs font-mono text-muted-foreground w-10 text-right">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 h-1 accent-primary cursor-pointer min-w-[100px]"
            />
            <span className="text-2xs font-mono text-muted-foreground w-10">
              {formatTime(duration)}
            </span>

            {/* Volume */}
            <VolumeIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={handleVolume}
              className="w-16 h-1 accent-primary cursor-pointer"
            />

            {/* Export WAV */}
            <TooltipWrapper content="Export stereo WAV">
              <Button
                size="sm"
                variant="neutral"
                className="h-7 text-2xs px-2"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
              </Button>
            </TooltipWrapper>
          </div>
        </>
      )}
    </div>
  );
}
