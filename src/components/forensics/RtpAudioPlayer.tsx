/**
 * RTP Audio Player — decodes RTP stream audio and provides playback controls.
 * Play/pause, seek slider, volume control, and WAV export.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { invokeTauri } from "@/api/invoke";
import { Button } from "@/components/ui/button";
import { Loader2, Download } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useNotificationStore } from "@/stores/notificationStore";

// Icons as inline SVG for play/pause/volume since they may not be in the icons lib
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

export interface RtpAudioPlayerProps {
  sessionId: string;
  ssrc: number;
  codecName: string;
  className?: string;
}

export function RtpAudioPlayer({ sessionId, ssrc, codecName, className }: RtpAudioPlayerProps) {
  const addNotification = useNotificationStore((s) => s.addNotification);

  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [exporting, setExporting] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Reset state when the stream changes (e.g. different stream or dialog selected)
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setAudioUrl(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [ssrc, sessionId]);

  // Decode the RTP stream to get audio data
  const handleDecode = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invokeTauri<{ wavBase64: string; durationSec: number }>(
        "rtp_stream_decode_audio",
        { sessionId, ssrc },
      );
      const url = `data:audio/wav;base64,${result.wavBase64}`;
      setAudioUrl(url);
      setDuration(result.durationSec);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addNotification({
        type: "error",
        title: "Audio Decode Failed",
        description: msg,
        source: "packet-capture",
      });
    } finally {
      setLoading(false);
    }
  }, [sessionId, ssrc, addNotification]);

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

  // Export WAV
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const path = await invokeTauri<string>("rtp_stream_export_wav", {
        sessionId,
        ssrc,
        path: "", // Empty = save dialog
      });
      addNotification({
        type: "success",
        title: "WAV Exported",
        description: `Saved to ${path}`,
        source: "packet-capture",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addNotification({
        type: "error",
        title: "WAV Export Failed",
        description: msg,
        source: "packet-capture",
      });
    } finally {
      setExporting(false);
    }
  }, [sessionId, ssrc, addNotification]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Only show for supported codecs
  const supported = codecName.startsWith("G.711") || codecName === "PCMU" || codecName === "PCMA" || codecName.startsWith("PT0") || codecName.startsWith("PT8");

  return (
    <div className={cn("surface p-3 space-y-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Selected Stream Audio</span>
        {!audioUrl && (
          <TooltipWrapper content={supported ? "Decode and play audio for this stream only" : `Codec ${codecName} not supported for playback`}>
            <Button
              size="sm"
              variant="neutral"
              className="h-6 text-xs"
              onClick={handleDecode}
              disabled={loading || !supported}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <PlayIcon className="h-3 w-3 mr-1" />
              )}
              {loading ? "Decoding..." : "Decode This Stream"}
            </Button>
          </TooltipWrapper>
        )}
      </div>

      {audioUrl && (
        <>
          <audio ref={audioRef} src={audioUrl} preload="auto" />

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="ui-control-shell h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-smooth"
            >
              {playing ? <PauseIcon className="h-3 w-3" /> : <PlayIcon className="h-3 w-3 ml-0.5" />}
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
              className="flex-1 h-1 accent-primary cursor-pointer"
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
            <Button
              size="sm"
              variant="neutral"
              className="h-6 text-xs"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </Button>
          </div>
        </>
      )}

      {!supported && (
        <p className="text-2xs text-muted-foreground">
          Audio playback is only available for G.711 (u-law/a-law) codecs.
        </p>
      )}
    </div>
  );
}

/** Compact play icon button for RTP stream table rows. */
export function RtpPlayButton({
  codecName,
}: {
  sessionId: string;
  ssrc: number;
  codecName: string;
}) {
  const supported = codecName.startsWith("G.711") || codecName === "PCMU" || codecName === "PCMA" || codecName.startsWith("PT0") || codecName.startsWith("PT8");

  if (!supported) return null;

  return (
    <TooltipWrapper content="Play stream audio">
      <button
        className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted/40 transition-smooth"
        onClick={(e) => {
          e.stopPropagation();
          // For table row buttons, we'd typically open a mini-player or select the stream
          // This is a placeholder — the full player is in RtpStreamDetailView
        }}
      >
        <PlayIcon className="h-3 w-3 text-muted-foreground" />
      </button>
    </TooltipWrapper>
  );
}
