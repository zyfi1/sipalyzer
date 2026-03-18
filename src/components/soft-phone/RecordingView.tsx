import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@/lib/tauriEvents";
import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import { listRecordings, deleteRecording, readRecordingData } from "@/lib/softphone";
import { speechTranscribeRecording, speechEnsureModel, speechModelStatus } from "@/api/speech";
import type { RecordingInfo } from "@/lib/softphone";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Mic, Trash2, Play, Pause, RefreshCw, Volume2, Clock, Loader2, Copy, Check, Download, Search } from "@/lib/icons";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Estimate duration from WAV file size (assumes 16-bit stereo 8kHz = 32000 bytes/sec) */
function estimateDuration(sizeBytes: number): number {
  const headerSize = 44;
  const bytesPerSec = 32000; // 8000 Hz * 2 channels * 2 bytes
  return Math.max(0, (sizeBytes - headerSize) / bytesPerSec);
}

/** Parse PCM samples from a WAV Uint8Array for waveform rendering. Returns normalized 0-1 peaks. */
function decodeWavPeaks(data: Uint8Array, barCount: number): number[] {
  // Find the "data" chunk
  let dataOffset = 44; // standard PCM header
  let dataSize = data.length - 44;
  // Try to find actual "data" subchunk for non-standard headers
  for (let i = 12; i < Math.min(data.length - 8, 200); i++) {
    if (data[i] === 0x64 && data[i + 1] === 0x61 && data[i + 2] === 0x74 && data[i + 3] === 0x61) {
      // "data"
      dataSize = (data[i + 4]!) | ((data[i + 5]!) << 8) | ((data[i + 6]!) << 16) | ((data[i + 7]!) << 24);
      dataOffset = i + 8;
      break;
    }
  }

  const bitsPerSample = (data[34] ?? 16) | ((data[35] ?? 0) << 8);
  const numChannels = (data[22] ?? 2) | ((data[23] ?? 0) << 8);
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const totalSamples = Math.floor(dataSize / blockAlign);

  if (totalSamples <= 0 || barCount <= 0) return new Array(barCount).fill(0);

  const samplesPerBar = Math.max(1, Math.floor(totalSamples / barCount));
  const peaks: number[] = [];
  let globalMax = 0;

  for (let bar = 0; bar < barCount; bar++) {
    let maxVal = 0;
    const startSample = bar * samplesPerBar;
    const endSample = Math.min(startSample + samplesPerBar, totalSamples);

    for (let s = startSample; s < endSample; s++) {
      const bytePos = dataOffset + s * blockAlign;
      if (bytePos + bytesPerSample > data.length) break;
      // Read first channel as signed 16-bit LE
      let sample: number;
      if (bytesPerSample === 2) {
        sample = ((data[bytePos] ?? 0) | ((data[bytePos + 1] ?? 0) << 8));
        if (sample >= 0x8000) sample -= 0x10000;
      } else {
        sample = (data[bytePos] ?? 128) - 128; // 8-bit unsigned
      }
      const abs = Math.abs(sample);
      if (abs > maxVal) maxVal = abs;
    }
    peaks.push(maxVal);
    if (maxVal > globalMax) globalMax = maxVal;
  }

  // Normalize to 0-1
  if (globalMax === 0) return peaks.map(() => 0.02);
  return peaks.map((p) => Math.max(0.02, p / globalMax));
}

const SPEED_OPTIONS = [1, 1.25, 1.5, 2] as const;

// ── Waveform Component ──────────────────────────────────────────────────────

interface WaveformProps {
  peaks: number[];
  progress: number; // 0-1
  onSeek?: (ratio: number) => void;
  className?: string;
  height?: number;
  activeColor?: string;
  inactiveColor?: string;
}

function Waveform({ peaks, progress, onSeek, className, height = 48 }: WaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onSeek || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(ratio);
    },
    [onSeek]
  );

  const barWidth = 2;
  const gap = 1.5;

  return (
    <div
      ref={containerRef}
      className={cn("relative select-none", onSeek && "cursor-pointer", className)}
      style={{ height }}
      onClick={handleClick}
      role={onSeek ? "slider" : undefined}
      aria-label="Waveform"
    >
      <div className="absolute inset-0 flex items-center gap-px">
        {peaks.map((peak, i) => {
          const barH = Math.max(2, peak * (height - 4));
          const played = i / peaks.length < progress;
          return (
            <div
              key={i}
              className="shrink-0 rounded-full transition-smooth duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]"
              style={{
                width: barWidth,
                height: barH,
                marginRight: gap,
                backgroundColor: played
                  ? "hsl(var(--foreground))"
                  : "hsl(var(--muted-foreground) / 0.2)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Mini Waveform (for list items) ──────────────────────────────────────────

function MiniWaveform({ peaks, className }: { peaks?: number[]; className?: string }) {
  // Simple static mini waveform for the list view
  const bars = peaks ?? Array.from({ length: 40 }, () => 0.1 + Math.random() * 0.4);
  return (
    <div className={cn("flex items-center gap-px h-4", className)}>
      {bars.map((p, i) => (
        <div
          key={i}
          className="shrink-0 rounded-full bg-muted-foreground/20"
          style={{ width: 1.5, height: Math.max(2, p * 14) }}
        />
      ))}
    </div>
  );
}

// ── Active Player Panel ─────────────────────────────────────────────────────

interface ActivePlayerProps {
  recording: RecordingInfo;
  audio: HTMLAudioElement;
  peaks: number[];
  currentTime: number;
  duration: number;
  playing: boolean;
  playbackRate: number;
  volume: number;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onSpeedChange: () => void;
  onVolumeChange: (volume: number) => void;
  onSkip: (delta: number) => void;
  onDelete: () => void;
  transcriptText: string | null;
  transcriptProgress: number;
  transcribing: boolean;
  onTranscribe: () => void;
}

function ActivePlayer({
  recording,
  peaks,
  currentTime,
  duration,
  playing,
  playbackRate,
  volume,
  onPlayPause,
  onSeek,
  onSpeedChange,
  onVolumeChange,
  onSkip,
  onDelete,
  transcriptText,
  transcriptProgress,
  transcribing,
  onTranscribe,
}: ActivePlayerProps) {
  const progress = duration > 0 ? currentTime / duration : 0;
  const [copiedTranscript, setCopiedTranscript] = useState(false);

  const handleWaveformSeek = useCallback(
    (ratio: number) => {
      onSeek(ratio * duration);
    },
    [onSeek, duration]
  );

  return (
    <div className="rounded-lg bg-gradient-to-b shadow-card from-muted/20 to-transparent p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
            <Volume2 className="h-4 w-4 text-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {recording.call_id_prefix || recording.filename}
            </p>
            <p className="text-2xs text-muted-foreground">
              {formatDate(recording.created_at)} &middot; {formatBytes(recording.size_bytes)}
            </p>
          </div>
        </div>
        <TooltipWrapper content="Delete recording">
          <button
            type="button"
            onClick={onDelete}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-smooth"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </TooltipWrapper>
      </div>

      {/* Waveform */}
      <Waveform
        peaks={peaks}
        progress={progress}
        onSeek={handleWaveformSeek}
        height={56}
        className="rounded-lg overflow-hidden"
      />

      {/* Progress bar (thin) */}
      <div
        className="h-1 rounded-full bg-muted/50 cursor-pointer overflow-hidden"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          onSeek(ratio * duration);
        }}
      >
          <div
            className="h-full rounded-full bg-foreground/60 transition-all duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {/* Skip back 10s */}
          <TooltipWrapper content="Back 10s">
            <button
              type="button"
              onClick={() => onSkip(-10)}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth text-2xs font-bold"
            >
              -10
            </button>
          </TooltipWrapper>

          {/* Play/Pause */}
          <button
            type="button"
            onClick={onPlayPause}
            className={cn(
              "h-10 w-10 rounded-full flex items-center justify-center transition-smooth shadow-sm",
              playing
                ? "bg-accent text-foreground hover:bg-accent/80"
                : "bg-accent text-foreground hover:bg-accent/80"
            )}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </button>

          {/* Skip forward 10s */}
          <TooltipWrapper content="Forward 10s">
            <button
              type="button"
              onClick={() => onSkip(10)}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth text-2xs font-bold"
            >
              +10
            </button>
          </TooltipWrapper>
        </div>

        {/* Time display */}
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatTime(currentTime)}
          <span className="text-muted-foreground/60 mx-1">/</span>
          {formatTime(duration)}
        </span>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 min-w-[110px]">
            <Volume2 className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="w-16 accent-foreground/80"
              aria-label="Playback volume"
            />
            <span className="text-2xs tabular-nums text-muted-foreground w-8 text-right">
              {Math.round(volume * 100)}%
            </span>
          </div>
          <TooltipWrapper content="Playback speed">
            <button
              type="button"
              onClick={onSpeedChange}
              className={cn(
                "h-7 px-2 rounded-lg text-2xs font-semibold tabular-nums transition-smooth",
                playbackRate !== 1
                  ? "bg-muted/40 text-foreground border border-foreground/20"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted/50 border border-transparent"
              )}
            >
              {playbackRate}x
            </button>
          </TooltipWrapper>
        </div>
      </div>

      {/* Transcription section */}
      <div className="ui-panel-shell p-3">
        <div className="flex items-center gap-2 text-2xs text-muted-foreground/60">
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
            <path d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9.5l-2.3 2.3a.5.5 0 0 1-.85-.35V11H4a2 2 0 0 1-2-2V4zm3.5 1a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 2a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3z" />
          </svg>
          <span className="uppercase tracking-wider font-medium">Transcription</span>
          {!transcriptText && !transcribing && (
            <button
              type="button"
              onClick={onTranscribe}
              className="ml-auto px-2.5 py-1 rounded-lg text-2xs font-medium bg-accent text-foreground hover:bg-muted/40 transition-smooth"
            >
              Transcribe
            </button>
          )}
        </div>
        {transcribing && (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin text-foreground" />
              <span>Transcribing... {Math.round(transcriptProgress * 100)}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-muted/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-foreground/60 transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]"
                style={{ width: `${transcriptProgress * 100}%` }}
              />
            </div>
            {transcriptText && (
              <div className="max-h-28 overflow-y-auto rounded-lg bg-background/50 p-2 mt-1">
                <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{transcriptText}</p>
              </div>
            )}
          </div>
        )}
        {!transcribing && transcriptText && (
          <div className="mt-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(transcriptText);
                  setCopiedTranscript(true);
                  setTimeout(() => setCopiedTranscript(false), 1500);
                }}
                className="h-6 px-2 rounded text-2xs flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-smooth"
              >
                {copiedTranscript ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedTranscript ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => {
                  saveExportFile(`transcript-${recording.call_id_prefix || recording.filename}.txt`, textToBase64(transcriptText), "Text files", "txt").catch(() => {});
                }}
                className="h-6 px-2 rounded text-2xs flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-smooth"
              >
                <Download className="h-3 w-3" />
                Export
              </button>
            </div>
            <div className="max-h-36 overflow-y-auto rounded-lg bg-background/50 p-2.5">
              <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap">{transcriptText}</p>
            </div>
          </div>
        )}
        {!transcribing && !transcriptText && (
          <p className="mt-2 text-xs text-muted-foreground/60 italic">
            Click Transcribe to generate a text transcript of this recording.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Recording List Item ─────────────────────────────────────────────────────

interface RecordingItemProps {
  rec: RecordingInfo;
  isActive: boolean;
  isLoading: boolean;
  onPlay: () => void;
  onDelete: () => void;
  onTranscribe: () => void;
  isTranscribing?: boolean;
  hasTranscript?: boolean;
}

function RecordingItem({ rec, isActive, isLoading, onPlay, onDelete, onTranscribe, isTranscribing, hasTranscript }: RecordingItemProps) {
  const estDuration = estimateDuration(rec.size_bytes);

  return (
    <div
      className={cn(
        "p-3 transition-smooth group",
        isActive
          ? "rounded-lg border border-border bg-muted/20"
          : "rounded-md border border-border/40 bg-card/50 hover:border-border hover:bg-card"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Play button */}
        <button
          type="button"
          onClick={onPlay}
          disabled={isLoading}
          className={cn(
            "h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-smooth shadow-sm",
            isActive
              ? "bg-muted/40 text-foreground border border-foreground/20"
              : isLoading
                ? "bg-muted/50 text-muted-foreground animate-live-breathe motion-reduce:animate-none border border-border/50"
                : "bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground border border-border/30 hover:border-border"
          )}
        >
          {isActive ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">
              {rec.call_id_prefix || rec.filename}
            </p>
            <span className="text-2xs tabular-nums text-muted-foreground/60 shrink-0 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTime(estDuration)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-2xs text-muted-foreground/60">
              {formatDate(rec.created_at)} &middot; {formatBytes(rec.size_bytes)}
            </p>
            {hasTranscript && (
              <span className="text-3xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                Transcribed
              </span>
            )}
          </div>
          {/* Mini waveform preview */}
          <MiniWaveform className="mt-1 opacity-50" />
        </div>

        {/* Delete */}
        <div className="flex items-center gap-1">
          <TooltipWrapper content={isTranscribing ? "Transcribing..." : "Transcribe recording"}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTranscribe();
              }}
              disabled={!!isTranscribing}
              className="h-7 px-2 rounded-lg text-2xs font-medium flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-smooth disabled:opacity-50"
            >
              {isTranscribing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mic className="h-3 w-3" />}
              {isTranscribing ? "..." : "Tx"}
            </button>
          </TooltipWrapper>
          <TooltipWrapper content="Delete recording">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="h-7 w-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-smooth text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </TooltipWrapper>
        </div>
      </div>
    </div>
  );
}

// ── Main RecordingView ──────────────────────────────────────────────────────

export function RecordingView() {
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Active player state
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeRec, setActiveRec] = useState<RecordingInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);

  // Transcription state per filename
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [transcriptProgress, setTranscriptProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const totalBytes = recordings.reduce((sum, r) => sum + r.size_bytes, 0);
  const totalDurationSec = recordings.reduce((sum, r) => sum + estimateDuration(r.size_bytes), 0);
  const transcriptCount = Object.keys(transcripts).length;

  const fetchRecordings = async () => {
    setLoading(true);
    try {
      const list = await listRecordings();
      setRecordings(list);
    } catch (err) {
      console.error("Failed to list recordings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  // Time update loop using requestAnimationFrame for smooth progress
  const updateTime = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      setCurrentTime(audioRef.current.currentTime);
      rafRef.current = requestAnimationFrame(updateTime);
    }
  }, []);

  const stopPlayback = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setActiveFile(null);
    setActiveRec(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPeaks([]);
    setPlaybackRate(1);
  }, []);

  const handlePlay = useCallback(
    async (rec: RecordingInfo) => {
      // Toggle off if same file
      if (activeFile === rec.filename) {
        if (audioRef.current) {
          if (audioRef.current.paused) {
            audioRef.current.play();
            setPlaying(true);
            rafRef.current = requestAnimationFrame(updateTime);
          } else {
            audioRef.current.pause();
            setPlaying(false);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
          }
        }
        return;
      }

      // Stop current
      stopPlayback();
      setLoadingFile(rec.filename);

      try {
        const base64 = await readRecordingData(rec.filename);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        // Decode waveform peaks
        const barCount = Math.min(200, Math.max(80, Math.floor(bytes.length / 1000)));
        const wavPeaks = decodeWavPeaks(bytes, barCount);
        setPeaks(wavPeaks);

        // Create audio
        const blob = new Blob([bytes], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;

        const audio = new Audio(url);
        audio.playbackRate = 1;
        audio.volume = volume;
        setPlaybackRate(1);

        audio.onloadedmetadata = () => {
          setDuration(audio.duration);
        };
        audio.onended = () => {
          setPlaying(false);
          setCurrentTime(audio.duration);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
        audio.onerror = () => {
          console.error("Playback error for", rec.filename);
          stopPlayback();
        };

        audioRef.current = audio;
        await audio.play();
        setActiveFile(rec.filename);
        setActiveRec(rec);
        setPlaying(true);
        setCurrentTime(0);
        rafRef.current = requestAnimationFrame(updateTime);
      } catch (err) {
        console.error("Failed to load recording:", err);
        stopPlayback();
      } finally {
        setLoadingFile(null);
      }
    },
    [activeFile, stopPlayback, updateTime, volume]
  );

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      // If at the end, restart
      if (audioRef.current.currentTime >= audioRef.current.duration - 0.1) {
        audioRef.current.currentTime = 0;
      }
      audioRef.current.play();
      setPlaying(true);
      rafRef.current = requestAnimationFrame(updateTime);
    } else {
      audioRef.current.pause();
      setPlaying(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
  }, [updateTime]);

  const handleSeek = useCallback((time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(time, audioRef.current.duration));
    setCurrentTime(audioRef.current.currentTime);
  }, []);

  const handleSkip = useCallback((delta: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(audioRef.current.currentTime + delta, audioRef.current.duration)
    );
    setCurrentTime(audioRef.current.currentTime);
  }, []);

  const handleSpeedChange = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate as (typeof SPEED_OPTIONS)[number]);
    const nextIdx = (idx + 1) % SPEED_OPTIONS.length;
    const next = SPEED_OPTIONS[nextIdx] ?? 1;
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [playbackRate]);

  const handleVolumeChange = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
    setVolume(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
  }, []);

  const handleDelete = useCallback(
    async (rec: RecordingInfo) => {
      if (activeFile === rec.filename) stopPlayback();
      try {
        await deleteRecording(rec.filename);
        setRecordings((prev) => prev.filter((r) => r.filename !== rec.filename));
      } catch (err) {
        console.error("Failed to delete recording:", err);
      }
    },
    [activeFile, stopPlayback]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
      audioRef.current = null;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // Listen for recording transcription events
  useEffect(() => {
    const unlistenPromise = listen<{
      request_id?: string;
      requestId?: string;
      text: string;
      is_final?: boolean;
      isFinal?: boolean;
      progress: number;
    }>("speech:recording_transcript", (event) => {
      const requestId = event.payload.request_id ?? event.payload.requestId;
      const isFinal = event.payload.is_final ?? event.payload.isFinal ?? false;
      const { text, progress } = event.payload;
      if (!requestId) return;
      setTranscriptProgress(progress);
      if (text) {
        setTranscripts((prev) => ({ ...prev, [requestId]: text }));
      }
      if (isFinal) {
        setTranscribing(null);
        setTranscriptProgress(0);
      }
    });
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  // Transcribe a recording
  const handleTranscribe = useCallback(async (filename: string) => {
    setTranscribing(filename);
    setTranscriptProgress(0);
    try {
      const status = await speechModelStatus();
      if (!status.downloaded) {
        await speechEnsureModel();
      }
      await speechTranscribeRecording(filename, filename);
    } catch (err) {
      console.error("Transcription failed:", err);
      setTranscribing(null);
      setTranscriptProgress(0);
    }
  }, []);

  // ── Render ──

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading recordings...</span>
        </div>
      </div>
    );
  }

  if (recordings.length === 0) {
    return (
      <div className="flex-1 flex flex-col p-6">
        <EmptyState
          variant="inline"
          icon={<Mic />}
          title="No Recordings"
          description="Start recording during an active call using the record button in the dialer. Recordings are saved as stereo WAV files."
        />
        <div className="flex justify-center mt-4">
          <Button variant="ghost" size="sm" onClick={fetchRecordings} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/20 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-xs font-medium text-muted-foreground">
              Recordings
              <span className="ml-1.5 text-muted-foreground/60">({recordings.length})</span>
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchRecordings} className="h-7 gap-1.5 text-xs">
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
        </div>
        <div className="flex items-center gap-2 text-2xs text-muted-foreground">
          <span className="px-2 py-0.5 rounded-full bg-muted/30">
            {formatBytes(totalBytes)}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-muted/30">
            {formatTime(totalDurationSec)}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-muted/30">
            {transcriptCount} transcript{transcriptCount === 1 ? "" : "s"}
          </span>
        </div>
        {recordings.length > 3 && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              type="text"
              placeholder="Search recordings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ui-control-shell h-8 w-full pl-8 pr-2 text-xs placeholder:text-muted-foreground/60"
            />
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Active player (shown at top when playing) */}
        {activeRec && audioRef.current && (
          <ActivePlayer
            recording={activeRec}
            audio={audioRef.current}
            peaks={peaks}
            currentTime={currentTime}
            duration={duration}
            playing={playing}
            playbackRate={playbackRate}
            volume={volume}
            onPlayPause={handlePlayPause}
            onSeek={handleSeek}
            onSpeedChange={handleSpeedChange}
            onVolumeChange={handleVolumeChange}
            onSkip={handleSkip}
            onDelete={() => handleDelete(activeRec)}
            transcriptText={transcripts[activeRec.filename] ?? null}
            transcriptProgress={transcribing === activeRec.filename ? transcriptProgress : 0}
            transcribing={transcribing === activeRec.filename}
            onTranscribe={() => handleTranscribe(activeRec.filename)}
          />
        )}

        {/* Recording list */}
        {recordings
          .filter((r) => r.filename !== activeFile)
          .filter((r) => {
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            const matchName = (r.call_id_prefix || r.filename).toLowerCase().includes(q);
            const matchTranscript = transcripts[r.filename]?.toLowerCase().includes(q);
            return matchName || matchTranscript;
          })
          .map((rec) => (
            <RecordingItem
              key={rec.filename}
              rec={rec}
              isActive={false}
              isLoading={loadingFile === rec.filename}
              onPlay={() => handlePlay(rec)}
              onDelete={() => handleDelete(rec)}
              onTranscribe={() => handleTranscribe(rec.filename)}
              isTranscribing={transcribing === rec.filename}
              hasTranscript={!!transcripts[rec.filename]}
            />
          ))}
      </div>
    </div>
  );
}
