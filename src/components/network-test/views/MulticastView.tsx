import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useMulticastStore, parseGroupKey } from "@/stores/multicastStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { ToolSubTabs } from "@/components/ui/tool-sub-tabs";

import { ResultSourceBadge } from "../components/ResultSourceBadge";
import { MetricCard } from "../components/MetricCard";
import { InterfacePicker } from "../components/InterfacePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { cn } from "@/lib/utils";
import { tooltips } from "@/lib/tooltips";
import { listen } from "@/lib/tauriEvents";
import {
  Globe,
  Loader2,
  Play,
  Radio,
  Search,
  Shield,
  Volume2,
  VolumeMute,
  Info,
  Send,
  StopIcon,
  Mic,
  MusicNote,
  Headphones,
  Activity,
  ChevronDown,
  ChevronUp,
  X,
  Clock,
  Layers,
  AlertCircle,
} from "@/lib/icons";
import type {
  MulticastPacketEvent,
  ListenerStats,
  AudioStreamState,
  AudioStreamMetrics,
  AudioGeneratorMetrics,
} from "@/types/multicast";
import * as api from "@/api/multicast";
import {
  listAudioInputDevices,
  listAudioOutputDevices,
  type AudioDevice,
} from "@/api/softphone";
import { ttsEngine, type TtsVoiceInfo } from "@/lib/ttsEngine";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

// ── Constants ────────────────────────────────────────────────────

const MULTICAST_TABS = [
  {
    id: "traffic",
    label: "Traffic",
    tip: "Multicast Traffic",
    tipDesc: "Join groups, monitor packets, play and generate audio — all in one view.",
  },
  {
    id: "igmp",
    label: "IGMP Diagnostics",
    tip: "IGMP Query & Snooping",
    tipDesc: "Discover active multicast groups on your network and verify switch snooping behavior.",
  },
] as const;

type TabId = (typeof MULTICAST_TABS)[number]["id"];

const TONE_TYPES = ["sine", "sweep", "noise", "silence"] as const;
const TONE_LABELS: Record<string, string> = { sine: "Sine", sweep: "Sweep", noise: "White Noise", silence: "Silence" };
const CODECS = ["PCMU", "PCMA", "G722"] as const;
const FREQ_PRESETS = [220, 440, 880, 1000, 2000] as const;
const TEST_COUNTS = [10, 50, 100, 500] as const;
const TEST_INTERVALS = [10, 50, 100] as const;

type SourceTab = "tone" | "microphone" | "tts";

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

const SOURCE_TABS: Array<{ id: SourceTab; label: string; icon: typeof MusicNote }> = [
  { id: "tone", label: "Tone", icon: MusicNote },
  { id: "microphone", label: "Mic", icon: Mic },
  { id: "tts", label: "TTS", icon: Send },
];

// ── Helpers ──────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0s";
  const whole = Math.floor(seconds);
  if (whole >= 3600) return `${Math.floor(whole / 3600)}h ${Math.floor((whole % 3600) / 60)}m`;
  if (whole >= 60) return `${Math.floor(whole / 60)}m ${whole % 60}s`;
  return `${whole}s`;
}

// ── Root ─────────────────────────────────────────────────────────

export function MulticastView({ toolId }: { toolId?: string }) {
  const [activeTab, setActiveTab] = useState<TabId>("traffic");

  return (
    <div className="flex flex-col gap-4">
      <ToolSubTabs
        tabs={MULTICAST_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        toolId={toolId}
      />

      {activeTab === "traffic" && <TrafficTab />}
      {activeTab === "igmp" && <IgmpTab />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ══ TRAFFIC TAB ═════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════

function TrafficTab() {
  const activeGroups = useMulticastStore((s) => s.activeGroups);
  const listenerStats = useMulticastStore((s) => s.listenerStats);
  const packetLog = useMulticastStore((s) => s.packetLog);
  const joinOp = useMulticastStore((s) => s.joinOp);
  const sendTestState = useMulticastStore((s) => s.sendTest);
  const lastSource = useMulticastStore((s) => s.lastSource);
  const runtimeError = useMulticastStore((s) => s.runtimeError);
  const clearRuntimeError = useMulticastStore((s) => s.clearRuntimeError);
  const audioStreams = useMulticastStore((s) => s.audioStreams);
  const audioVolume = useMulticastStore((s) => s.audioVolume);
  const audioMuted = useMulticastStore((s) => s.audioMuted);
  const generators = useMulticastStore((s) => s.generators);

  const targetGroup = useMulticastStore((s) => s.targetGroup);
  const setTargetGroup = useMulticastStore((s) => s.setTargetGroup);
  const targetPort = useMulticastStore((s) => s.targetPort);
  const setTargetPort = useMulticastStore((s) => s.setTargetPort);
  const testCount = useMulticastStore((s) => s.testCount);
  const setTestCount = useMulticastStore((s) => s.setTestCount);
  const testInterval = useMulticastStore((s) => s.testInterval);
  const setTestInterval = useMulticastStore((s) => s.setTestInterval);
  const testTtl = useMulticastStore((s) => s.testTtl);
  const setTestTtl = useMulticastStore((s) => s.setTestTtl);
  const selectedInterface = useMulticastStore((s) => s.selectedInterface);
  const setSelectedInterface = useMulticastStore((s) => s.setSelectedInterface);

  const joinGroup = useMulticastStore((s) => s.joinGroup);
  const leaveGroup = useMulticastStore((s) => s.leaveGroup);
  const startSendTest = useMulticastStore((s) => s.startSendTest);
  const addPacketEvents = useMulticastStore((s) => s.addPacketEvents);
  const updateListenerStats = useMulticastStore((s) => s.updateListenerStats);
  const updateAudioStream = useMulticastStore((s) => s.updateAudioStream);
  const clearPacketLog = useMulticastStore((s) => s.clearPacketLog);
  const startAudio = useMulticastStore((s) => s.startAudio);
  const stopAudio = useMulticastStore((s) => s.stopAudio);
  const setAudioVolume = useMulticastStore((s) => s.setAudioVolume);
  const setAudioMuted = useMulticastStore((s) => s.setAudioMuted);
  const setAudioOutputDevice = useMulticastStore((s) => s.setAudioOutputDevice);
  const audioOutputDeviceId = useMulticastStore((s) => s.audioOutputDeviceId);

  const genToneType = useMulticastStore((s) => s.genToneType);
  const genFrequency = useMulticastStore((s) => s.genFrequency);
  const genAmplitude = useMulticastStore((s) => s.genAmplitude);
  const genCodec = useMulticastStore((s) => s.genCodec);
  const genSourceMode = useMulticastStore((s) => s.genSourceMode);
  const genInputDeviceId = useMulticastStore((s) => s.genInputDeviceId);
  const genInputGain = useMulticastStore((s) => s.genInputGain);
  const ttsText = useMulticastStore((s) => s.ttsText);
  const ttsSpeaking = useMulticastStore((s) => s.ttsSpeaking);

  const startGenerator = useMulticastStore((s) => s.startGenerator);
  const stopGenerator = useMulticastStore((s) => s.stopGenerator);
  const setGenToneType = useMulticastStore((s) => s.setGenToneType);
  const setGenFrequency = useMulticastStore((s) => s.setGenFrequency);
  const setGenAmplitude = useMulticastStore((s) => s.setGenAmplitude);
  const setGenCodec = useMulticastStore((s) => s.setGenCodec);
  const setGenSourceMode = useMulticastStore((s) => s.setGenSourceMode);
  const setGenInputDevice = useMulticastStore((s) => s.setGenInputDevice);
  const setGenInputGain = useMulticastStore((s) => s.setGenInputGain);
  const setTtsText = useMulticastStore((s) => s.setTtsText);
  const setTtsSpeaking = useMulticastStore((s) => s.setTtsSpeaking);
  const updateGeneratorTone = useMulticastStore((s) => s.updateGeneratorTone);
  const updateGeneratorSource = useMulticastStore((s) => s.updateGeneratorSource);
  const updateGeneratorInputGain = useMulticastStore((s) => s.updateGeneratorInputGain);

  const selectedGroupKey = useMulticastStore((s) => s.selectedGroupKey);
  const setSelectedGroupKey = useMulticastStore((s) => s.setSelectedGroupKey);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ctx = resolvedContext("multicast");

  // ── Derived state ──────────────────────────────────────────────
  const joining = joinOp.status === "running";
  const testing = sendTestState.status === "running";
  const hasGroups = activeGroups.length > 0;

  const parsed = selectedGroupKey ? parseGroupKey(selectedGroupKey) : null;
  const selGroup = parsed?.group ?? activeGroups[0]?.group;
  const selPort = parsed?.port ?? activeGroups[0]?.port ?? 5004;
  const stats = selGroup ? listenerStats[selGroup] : null;
  const audioPlaying = selGroup ? !!audioStreams[selGroup]?.playing : false;
  const audioStream = selGroup ? audioStreams[selGroup] : undefined;
  const isGenerating = selGroup ? !!generators[selGroup] : false;

  const source = (lastSource as Record<string, { source: "local" | "remote"; agentId?: string } | undefined>).join;
  const agentName = source?.source === "remote" ? resolvedAgentName("multicast") ?? undefined : undefined;

  // ── Audio device state ─────────────────────────────────────────
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [ttsVoices, setTtsVoices] = useState<TtsVoiceInfo[]>([]);
  const [ttsVoiceURI, setTtsVoiceURI] = useState<string | null>(null);
  const [ttsRate, setTtsRate] = useState(1.0);
  const [speechInputActive, setSpeechInputActive] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechSupported = useMemo(() => {
    const win = window as unknown as {
      SpeechRecognition?: BrowserSpeechRecognitionCtor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
    };
    return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
  }, []);

  useEffect(() => {
    listAudioOutputDevices().then(setOutputDevices).catch(() => {});
    listAudioInputDevices().then(setInputDevices).catch(() => {});
    ttsEngine.loadVoices().then((v) => {
      setTtsVoices(v);
      const defaultVoice = v.find((voice) => voice.isDefault);
      if (defaultVoice) setTtsVoiceURI(defaultVoice.voiceURI);
    });
  }, []);

  // Wire TTS callbacks
  useEffect(() => {
    ttsEngine.onStart = () => setTtsSpeaking(true);
    ttsEngine.onEnd = () => setTtsSpeaking(false);
    ttsEngine.onError = () => setTtsSpeaking(false);
  }, [setTtsSpeaking]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  // ── Streaming event listeners ──────────────────────────────────
  const [chartData, setChartData] = useState<Array<{ time: string; pps: number }>>([]);
  const waveformRef = useRef<Float32Array | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const packetQueueRef = useRef<MulticastPacketEvent[]>([]);
  const [audioMetrics, setAudioMetrics] = useState<AudioStreamMetrics | null>(null);
  const [generatorMetrics, setGeneratorMetrics] = useState<AudioGeneratorMetrics | null>(null);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    listen<MulticastPacketEvent[]>("multicast:packet-batch", (e) => {
      if (Array.isArray(e.payload) && e.payload.length > 0) {
        packetQueueRef.current.push(...e.payload);
      }
    }).then((fn) => unsubs.push(fn));
    // Backward-compatible fallback for older backends.
    listen<MulticastPacketEvent>("multicast:packet-received", (e) => {
      packetQueueRef.current.push(e.payload);
    }).then((fn) => unsubs.push(fn));
    listen<ListenerStats>("multicast:listener-stats", (e) => {
      updateListenerStats(e.payload);
      setChartData((prev) => [
        ...prev.slice(-59),
        { time: new Date().toLocaleTimeString(), pps: e.payload.packets_per_sec },
      ]);
    }).then((fn) => unsubs.push(fn));
    listen<AudioStreamState>("multicast:audio-stream", (e) =>
      updateAudioStream(e.payload),
    ).then((fn) => unsubs.push(fn));
    const flush = setInterval(() => {
      if (packetQueueRef.current.length === 0) return;
      const batch = packetQueueRef.current.splice(0, packetQueueRef.current.length);
      addPacketEvents(batch);
    }, 120);
    return () => {
      clearInterval(flush);
      unsubs.forEach((fn) => fn());
    };
  }, [addPacketEvents, updateListenerStats, updateAudioStream]);

  // ── Waveform drawing ───────────────────────────────────────────
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const samples = waveformRef.current;
    if (!canvas || !samples || samples.length === 0) return;
    const c = canvas.getContext("2d");
    if (!c) return;
    const { width, height } = canvas;
    c.clearRect(0, 0, width, height);

    const grad = c.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "rgba(96,165,250,0.15)");
    grad.addColorStop(1, "rgba(96,165,250,0)");

    c.strokeStyle = "#60a5fa";
    c.lineWidth = 1.5;
    c.beginPath();
    const step = samples.length / width;
    for (let i = 0; i < width; i++) {
      const idx = Math.floor(i * step);
      const sample = samples[idx] ?? 0;
      const y = ((1 - sample) / 2) * height;
      if (i === 0) c.moveTo(i, y);
      else c.lineTo(i, y);
    }
    c.stroke();
    c.lineTo(width, height);
    c.lineTo(0, height);
    c.closePath();
    c.fillStyle = grad;
    c.fill();
  }, []);

  useEffect(() => {
    const playingGroups = Object.values(audioStreams).filter((s) => s.playing);
    if (playingGroups.length === 0 || !playingGroups[0]) return;
    const group = playingGroups[0].group;
    const interval = setInterval(async () => {
      try {
        const wf = await api.multicastAudioGetWaveform(group);
        waveformRef.current = new Float32Array(wf.samples);
        drawWaveform();
      } catch {}
    }, 80);
    return () => clearInterval(interval);
  }, [audioStreams, drawWaveform]);

  useEffect(() => {
    if (!selGroup) {
      setAudioMetrics(null);
      setGeneratorMetrics(null);
      return;
    }

    let cancelled = false;
    const loadMetrics = async () => {
      try {
        if (audioPlaying) {
          const metrics = await api.multicastAudioGetMetrics(selGroup);
          if (!cancelled) setAudioMetrics(metrics);
        } else if (!cancelled) {
          setAudioMetrics(null);
        }
      } catch {
        if (!cancelled) setAudioMetrics(null);
      }

      try {
        if (isGenerating) {
          const metrics = await api.multicastGenerateGetMetrics(selGroup);
          if (!cancelled) setGeneratorMetrics(metrics);
        } else if (!cancelled) {
          setGeneratorMetrics(null);
        }
      } catch {
        if (!cancelled) setGeneratorMetrics(null);
      }
    };

    void loadMetrics();
    const interval = window.setInterval(loadMetrics, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selGroup, audioPlaying, isGenerating]);

  // ── Handlers ───────────────────────────────────────────────────
  const handleJoin = useCallback(() => {
    if (!targetGroup.trim()) return;
    joinGroup(targetGroup.trim(), targetPort, selectedInterface || undefined, ctx);
  }, [targetGroup, targetPort, selectedInterface, ctx, joinGroup]);

  const handleSendTest = useCallback(() => {
    if (!targetGroup.trim()) return;
    startSendTest(targetGroup.trim(), targetPort, testCount, testInterval, testTtl, ctx);
  }, [targetGroup, targetPort, testCount, testInterval, testTtl, ctx, startSendTest]);

  const handleToneChange = useCallback((tone: string) => {
    setGenToneType(tone);
    if (selGroup && generators[selGroup]) updateGeneratorTone(selGroup);
  }, [selGroup, generators, setGenToneType, updateGeneratorTone]);

  const handleFreqChange = useCallback((freq: number) => {
    setGenFrequency(freq);
    if (selGroup && generators[selGroup]) updateGeneratorTone(selGroup);
  }, [selGroup, generators, setGenFrequency, updateGeneratorTone]);

  const handleAmpChange = useCallback((amp: number) => {
    setGenAmplitude(amp);
    if (selGroup && generators[selGroup]) updateGeneratorTone(selGroup);
  }, [selGroup, generators, setGenAmplitude, updateGeneratorTone]);

  const handleSourceModeChange = useCallback((mode: SourceTab) => {
    setGenSourceMode(mode);
    if (selGroup && generators[selGroup]) {
      updateGeneratorSource(selGroup);
    }
  }, [selGroup, generators, setGenSourceMode, updateGeneratorSource]);

  const handleInputGainChange = useCallback((gain: number) => {
    setGenInputGain(gain);
    if (selGroup && generators[selGroup]) {
      updateGeneratorInputGain(selGroup);
    }
  }, [selGroup, generators, setGenInputGain, updateGeneratorInputGain]);

  const handleInputDeviceChange = useCallback((deviceId: string) => {
    setGenInputDevice(deviceId || null);
    if (selGroup && generators[selGroup]) {
      updateGeneratorSource(selGroup);
    }
  }, [selGroup, generators, setGenInputDevice, updateGeneratorSource]);

  const handleTtsSpeak = useCallback(() => {
    if (!ttsText.trim()) return;
    ttsEngine.speak(ttsText, { voiceURI: ttsVoiceURI, rate: ttsRate, volume: 0.8 });
  }, [ttsText, ttsVoiceURI, ttsRate]);

  const handleTtsStop = useCallback(() => {
    ttsEngine.stop();
    setTtsSpeaking(false);
  }, [setTtsSpeaking]);

  const handleSpeechInputToggle = useCallback(() => {
    if (!speechSupported) return;
    if (speechInputActive) {
      recognitionRef.current?.stop();
      setSpeechInputActive(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: BrowserSpeechRecognitionCtor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
    };
    const RecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!RecognitionCtor) return;

    const recognition = new RecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const candidate = event.results[i]?.[0]?.transcript;
        if (candidate) text += candidate;
      }
      if (text.trim().length > 0) {
        setTtsText(text.trim());
      }
    };
    recognition.onerror = () => {
      setSpeechInputActive(false);
    };
    recognition.onend = () => {
      setSpeechInputActive(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setSpeechInputActive(true);
    recognition.start();
  }, [setTtsText, speechInputActive, speechSupported]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* ═══ JOIN CONTROLS BAR ═══════════════════════════════════ */}
      <div className="surface-flat app-view-surface-pad">
        <div className="flex flex-wrap items-center gap-3">
          <TooltipWrapper entry={tooltips.netMcastGroup} side="bottom">
            <span><Globe className="h-4 w-4 text-muted-foreground/60 shrink-0 cursor-help" /></span>
          </TooltipWrapper>
          <Input
            value={targetGroup}
            onChange={(e) => setTargetGroup(e.target.value)}
            placeholder="Multicast group — e.g. 239.255.0.1"
            className="h-10 flex-1 min-w-[140px] font-mono"
            disabled={joining}
            onKeyDown={(e) => e.key === "Enter" && !joining && targetGroup.trim() && handleJoin()}
          />
          <div className="h-5 w-px bg-border/20" />
          <TooltipWrapper entry={tooltips.netMcastPort}>
            <Input
              type="number"
              value={targetPort}
              onChange={(e) => setTargetPort(parseInt(e.target.value, 10) || 5004)}
              placeholder="Port"
              className="h-10 w-24 font-mono"
              disabled={joining}
            />
          </TooltipWrapper>
          <div className="h-5 w-px bg-border/20" />
          <InterfacePicker
            value={selectedInterface}
            onChange={setSelectedInterface}
            disabled={joining}
          />
          <Button
            className="h-10 gap-2 px-5"
            onClick={handleJoin}
            disabled={joining || !targetGroup.trim()}
          >
            {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {joining ? "Joining…" : "Join Group"}
          </Button>
        </div>
        {joinOp.status === "error" && joinOp.error && (
          <div className="mt-2 text-xs text-destructive">
            {joinOp.error}
          </div>
        )}
        {source && (
          <div className="mt-2">
            <ResultSourceBadge source={source.source} agentName={agentName} />
          </div>
        )}
        <div className="mt-2 text-2xs text-muted-foreground/70">
          Join, listen, transmit, then validate flow and throughput.
        </div>
      </div>

      {runtimeError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="text-xs text-destructive/95 flex-1">{runtimeError}</div>
          <button
            type="button"
            className="h-5 w-5 rounded hover:bg-destructive/15 flex items-center justify-center"
            onClick={clearRuntimeError}
            aria-label="Dismiss error"
          >
            <X className="h-3.5 w-3.5 text-destructive/80" />
          </button>
        </div>
      )}

      {/* ═══ ACTIVE GROUPS ═════════════════════════════════════════ */}
      {hasGroups && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Layers className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="section-label-sm">Active Groups</span>
            <Badge variant="outline" className="text-2xs font-mono ml-1">
              {activeGroups.length}
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {activeGroups.map((g) => {
              const key = `${g.group}:${g.port}`;
              const isSelected = key === selectedGroupKey || (!selectedGroupKey && g === activeGroups[0]);
              const gStats = listenerStats[g.group];
              const isActive = gStats && gStats.packets_per_sec > 0;
              const hasAudio = !!audioStreams[g.group]?.playing;
              const hasGen = !!generators[g.group];
              const elapsed = g.joined_at
                ? Math.floor((Date.now() - new Date(g.joined_at).getTime()) / 1000)
                : 0;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedGroupKey(key)}
                  className={cn(
                    "relative rounded-lg border text-left p-3.5 transition-smooth group/card",
                    "hover:shadow-md hover:border-primary/30",
                    isSelected
                      ? "bg-primary/5 border-primary/30 shadow-sm ring-1 ring-primary/15"
                      : "bg-muted/20 border-border/20 hover:bg-muted/30",
                  )}
                >
                  {/* Status dot + address */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn(
                      "h-2.5 w-2.5 rounded-full shrink-0 transition-smooth",
                      isActive ? "bg-success status-online motion-reduce:animate-none" : "bg-muted-foreground/20",
                    )} />
                    <span className="font-mono text-sm font-medium truncate">{g.group}</span>
                    <span className="font-mono text-2xs text-muted-foreground/60">:{g.port}</span>
                    {/* Leave button */}
                    <TooltipWrapper content="Leave group">
                      <button
                        type="button"
                        className={cn(
                          "ml-auto h-6 w-6 rounded-lg flex items-center justify-center shrink-0 transition-smooth",
                          "text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10",
                          "opacity-0 group-hover/card:opacity-100",
                        )}
                      onClick={(e) => { e.stopPropagation(); leaveGroup(g.group, g.port); }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </TooltipWrapper>
                  </div>

                  {/* Metrics row */}
                  <div className="grid grid-cols-3 gap-2 text-2xs">
                    <div>
                      <span className="text-muted-foreground/60 block">Packets</span>
                      <span className="font-mono tabular-nums font-medium">
                        {g.packets_received.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 block">Data</span>
                      <span className="font-mono tabular-nums font-medium">
                        {formatBytes(g.bytes_received)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 block">Sources</span>
                      <span className="font-mono tabular-nums font-medium">
                        {g.sources_seen.length}
                      </span>
                    </div>
                  </div>

                  {/* Status badges row */}
                  <div className="flex items-center gap-1.5 mt-2">
                    {elapsed > 0 && (
                      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground/60">
                        <Clock className="h-3 w-3" />
                        {elapsed >= 3600
                          ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
                          : elapsed >= 60
                            ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
                            : `${elapsed}s`}
                      </span>
                    )}
                    {gStats && (
                      <span className="text-2xs font-mono text-muted-foreground/60 tabular-nums">
                        {gStats.packets_per_sec} pps
                      </span>
                    )}
                    <span className="flex-1" />
                    {hasAudio && (
                      <Badge variant="outline" className="text-3xs h-5 bg-success/10 text-success border-success/20">
                        <Headphones className="h-2.5 w-2.5 mr-0.5" />RX
                      </Badge>
                    )}
                    {hasGen && (
                      <Badge variant="outline" className="text-3xs h-5 bg-primary/10 text-primary border-primary/20">
                        <Send className="h-2.5 w-2.5 mr-0.5" />TX
                      </Badge>
                    )}
                  </div>

                  {/* Selected indicator bar */}
                  {isSelected && (
                    <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ EMPTY STATE ════════════════════════════════════════ */}
      {!hasGroups && !joining && (
        <EmptyState
          variant="inline"
          icon={<Radio />}
          title="No active multicast groups"
          description="Enter a multicast address and port above, then click Join Group to start monitoring traffic."
          className="h-full min-h-0 p-6"
        />
      )}

      {/* ═══ MULTICAST WORKBENCH ══════════════════════════════════ */}
      {hasGroups && selGroup && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* ── Live Monitor ─────────────────────────── */}
            <div className="ui-hero-surface overflow-hidden">
              <div className="flex items-center gap-2 px-5 pt-4 pb-2">
                <Activity className="h-3.5 w-3.5 text-primary/60" />
                <h3 className="section-label-sm">Live Monitor</h3>
                <span className="ml-auto text-2xs font-mono text-muted-foreground/60 tabular-nums">
                  {selGroup}:{selPort}
                </span>
              </div>
              <div className="px-5 pb-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn("text-2xs", stats && stats.packets_per_sec > 0 ? "text-success border-success/30 bg-success/10" : "text-muted-foreground border-border/30 bg-muted/10")}>
                    {stats && stats.packets_per_sec > 0 ? "Traffic Active" : "Traffic Idle"}
                  </Badge>
                  <Badge variant="outline" className={cn("text-2xs", audioPlaying ? "text-success border-success/30 bg-success/10" : "text-muted-foreground border-border/30 bg-muted/10")}>
                    {audioPlaying ? "RX Listening" : "RX Stopped"}
                  </Badge>
                  <Badge variant="outline" className={cn("text-2xs", isGenerating ? "text-primary border-primary/30 bg-primary/10" : "text-muted-foreground border-border/30 bg-muted/10")}>
                    {isGenerating ? "TX Running" : "TX Stopped"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <MetricCard
                    label="Packets/sec"
                    value={stats?.packets_per_sec ?? "—"}
                    status={!stats ? "idle" : stats.packets_per_sec < 1500 ? "pass" : stats.packets_per_sec < 6000 ? "warn" : "fail"}
                  />
                  <MetricCard label="Bytes/sec" value={stats ? formatBytes(stats.bytes_per_sec) : "—"} />
                  <MetricCard label="Sources" value={stats?.unique_sources ?? "—"} />
                  <MetricCard label="Session" value={formatDuration(stats?.duration_secs)} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <MetricCard
                    label="RX Jitter"
                    value={audioMetrics ? `${audioMetrics.jitter_ms.toFixed(1)} ms` : "—"}
                    status={!audioMetrics ? "idle" : audioMetrics.jitter_ms < 8 ? "pass" : audioMetrics.jitter_ms < 20 ? "warn" : "fail"}
                  />
                  <MetricCard
                    label="RX Loss"
                    value={audioMetrics ? `${audioMetrics.loss_percent.toFixed(2)}%` : "—"}
                    status={!audioMetrics ? "idle" : audioMetrics.loss_percent < 0.5 ? "pass" : audioMetrics.loss_percent < 2 ? "warn" : "fail"}
                  />
                  <MetricCard
                    label="RX Bitrate"
                    value={audioMetrics ? `${audioMetrics.bitrate_kbps.toFixed(1)} kbps` : "—"}
                  />
                  <MetricCard
                    label="TX Bitrate"
                    value={generatorMetrics ? `${generatorMetrics.bitrate_kbps.toFixed(1)} kbps` : "—"}
                  />
                </div>
              </div>
            </div>

            {/* ── Active Listening ─────────────────────── */}
            <div className="surface-flat overflow-hidden">
              <div className="flex items-center gap-2 px-5 pt-4 pb-2">
                <Headphones className="h-3.5 w-3.5 text-success/60" />
                <h3 className="section-label-sm">Listening Studio</h3>
                <TooltipWrapper title="Active Listening" description="Decode live RTP from the selected multicast stream and inspect quality in real time." side="right">
                  <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help" />
                </TooltipWrapper>
              </div>
              <div className="px-5 pb-4 space-y-3">
                {outputDevices.length > 0 && (
                  <select
                    className="w-full h-8 rounded-lg bg-muted/10 border border-border/20 text-xs px-2 text-foreground"
                    value={audioOutputDeviceId ?? ""}
                    onChange={(e) => setAudioOutputDevice(e.target.value || null)}
                  >
                    <option value="">Default output device</option>
                    {outputDevices.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}{d.isDefault ? " (Default)" : ""}</option>
                    ))}
                  </select>
                )}

                <div className="flex items-center gap-2">
                  {!audioPlaying ? (
                    <Button className="h-9 gap-2" disabled={!selGroup} onClick={() => selGroup && startAudio(selGroup, selPort)}>
                      <Play className="h-4 w-4" /> Start Listening
                    </Button>
                  ) : (
                    <Button variant="destructive" className="h-9 gap-2" onClick={() => selGroup && stopAudio(selGroup)}>
                      <StopIcon className="h-4 w-4" /> Stop Listening
                    </Button>
                  )}
                  <span className="text-2xs text-muted-foreground/60 ml-auto">
                    Volume
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={audioVolume}
                    onChange={(e) => selGroup && setAudioVolume(selGroup, parseFloat(e.target.value))}
                    className="w-24 h-2 rounded-full appearance-none bg-muted/30 accent-primary"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => selGroup && setAudioMuted(selGroup, !audioMuted)}
                  >
                    {audioMuted ? <VolumeMute className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </Button>
                </div>

                <canvas
                  ref={canvasRef}
                  width={400}
                  height={64}
                  className={cn("w-full h-[64px] rounded-lg bg-muted/10 block", audioMuted && "opacity-50")}
                />

                {audioStream ? (
                  <div className="rounded-lg border border-border/20 bg-muted/10 px-3 py-2 text-2xs font-mono text-muted-foreground/70">
                    {audioStream.codec_name} @ {audioStream.sample_rate}Hz | {audioStream.source_ip} | SSRC {audioStream.ssrc}
                  </div>
                ) : (
                  <EmptyState
                    variant="inline"
                    title="No receiver metadata yet"
                    description="No active receiver stream metadata yet."
                    className="h-full min-h-0 p-6 text-left"
                  />
                )}
              </div>
            </div>

            {/* ── Transmit Controls ───────────────────── */}
            <div className="surface-flat overflow-hidden">
              <div className="flex items-center gap-2 px-5 pt-4 pb-2">
                <Send className="h-3.5 w-3.5 text-primary/60" />
                <h3 className="section-label-sm">Transmit Studio</h3>
                <Badge variant="outline" className={cn("ml-auto text-2xs", isGenerating ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/10 border-border/30 text-muted-foreground")}>
                  {isGenerating ? "On Air" : "Standby"}
                </Badge>
              </div>
              <div className="px-5 pb-4 space-y-3">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/10">
                  {SOURCE_TABS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleSourceModeChange(id)}
                      className={cn(
                        "flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-smooth flex-1 justify-center",
                        genSourceMode === id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground/60 hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  {!isGenerating ? (
                    <Button className="h-9 gap-2" disabled={!selGroup} onClick={() => selGroup && startGenerator(selGroup, selPort)}>
                      <Play className="h-4 w-4" /> Start Transmit
                    </Button>
                  ) : (
                    <Button variant="destructive" className="h-9 gap-2" onClick={() => selGroup && stopGenerator(selGroup)}>
                      <StopIcon className="h-4 w-4" /> Stop
                    </Button>
                  )}
                  <div className="flex items-center gap-1 ml-auto">
                    {CODECS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setGenCodec(c)}
                        disabled={isGenerating}
                        className={cn(
                          "h-7 rounded-lg text-2xs font-mono px-2 transition-smooth",
                          genCodec === c ? "bg-primary/15 text-primary font-medium ring-1 ring-primary/20" : "bg-muted/10 text-muted-foreground/60 hover:bg-muted/20 hover:text-foreground",
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {genSourceMode === "tone" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {TONE_TYPES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => handleToneChange(t)}
                          className={cn(
                            "h-7 rounded-lg text-2xs px-2 transition-smooth",
                            genToneType === t ? "bg-primary/15 text-primary font-medium ring-1 ring-primary/20" : "bg-muted/10 text-muted-foreground/60 hover:bg-muted/20 hover:text-foreground",
                          )}
                        >
                          {TONE_LABELS[t]}
                        </button>
                      ))}
                    </div>
                    {genToneType === "sine" && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {FREQ_PRESETS.map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => handleFreqChange(f)}
                            className={cn(
                              "h-7 rounded-lg text-2xs font-mono px-2 transition-smooth",
                              genFrequency === f ? "bg-primary/15 text-primary font-medium ring-1 ring-primary/20" : "bg-muted/10 text-muted-foreground/60 hover:bg-muted/20 hover:text-foreground",
                            )}
                          >
                            {f >= 1000 ? `${f / 1000}k` : f}
                          </button>
                        ))}
                        <span className="text-2xs text-muted-foreground/60 font-mono tabular-nums ml-1">
                          {genFrequency} Hz
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-2xs text-muted-foreground/60">Level</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={genAmplitude}
                        onChange={(e) => handleAmpChange(parseFloat(e.target.value))}
                        className="flex-1 h-2 rounded-full appearance-none bg-muted/30 accent-primary"
                      />
                      <span className="text-2xs text-muted-foreground/60 font-mono tabular-nums w-10">
                        {Math.round(genAmplitude * 100)}%
                      </span>
                    </div>
                  </div>
                )}

                {genSourceMode === "microphone" && (
                  <div className="space-y-2">
                    {inputDevices.length > 0 && (
                      <select
                        className="w-full h-8 rounded-lg bg-muted/10 border border-border/20 text-xs px-2 text-foreground"
                        value={genInputDeviceId ?? ""}
                        onChange={(e) => handleInputDeviceChange(e.target.value)}
                      >
                        <option value="">Default input device</option>
                        {inputDevices.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}{d.isDefault ? " (Default)" : ""}</option>
                        ))}
                      </select>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-2xs text-muted-foreground/60">Gain</span>
                      <input
                        type="range"
                        min={0}
                        max={4}
                        step={0.1}
                        value={genInputGain}
                        onChange={(e) => handleInputGainChange(parseFloat(e.target.value))}
                        className="flex-1 h-2 rounded-full appearance-none bg-muted/30 accent-primary"
                      />
                      <span className="text-2xs text-muted-foreground/60 font-mono tabular-nums w-12">
                        {genInputGain.toFixed(1)}x
                      </span>
                    </div>
                  </div>
                )}

                {genSourceMode === "tts" && (
                  <div className="space-y-2">
                    <textarea
                      value={ttsText}
                      onChange={(e) => setTtsText(e.target.value)}
                      placeholder="Type text to speak over multicast..."
                      className="w-full h-16 rounded-lg bg-muted/10 border border-border/20 text-xs p-2 text-foreground resize-none placeholder:text-muted-foreground/60"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-2xs" onClick={() => setTtsText("This is a multicast audio verification phrase.")}>
                        Insert Test Phrase
                      </Button>
                      <Button
                        size="sm"
                        variant={speechInputActive ? "destructive" : "outline"}
                        className="h-7 gap-1.5 text-2xs"
                        disabled={!speechSupported}
                        onClick={handleSpeechInputToggle}
                      >
                        <Mic className="h-3.5 w-3.5" />
                        {speechInputActive ? "Stop Dictation" : "Speech Input"}
                      </Button>
                      {!ttsSpeaking ? (
                        <Button
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          disabled={!ttsText.trim() || !ttsEngine.available}
                          onClick={handleTtsSpeak}
                        >
                          <Play className="h-3.5 w-3.5" /> Preview Voice
                        </Button>
                      ) : (
                        <Button size="sm" variant="destructive" className="h-7 gap-1.5 text-xs" onClick={handleTtsStop}>
                          <StopIcon className="h-3.5 w-3.5" /> Stop
                        </Button>
                      )}
                    </div>
                    {!speechSupported && (
                      <div className="text-2xs text-muted-foreground/60">
                        Speech input is not available in this environment.
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {ttsVoices.length > 0 && (
                        <select
                          className="flex-1 h-8 rounded-lg bg-muted/10 border border-border/20 text-xs px-2 text-foreground"
                          value={ttsVoiceURI ?? ""}
                          onChange={(e) => setTtsVoiceURI(e.target.value || null)}
                        >
                          {ttsVoices.map((v) => (
                            <option key={v.voiceURI} value={v.voiceURI}>
                              {v.name} ({v.lang}){v.isDefault ? " ★" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        type="range"
                        min={0.5}
                        max={2}
                        step={0.1}
                        value={ttsRate}
                        onChange={(e) => setTtsRate(parseFloat(e.target.value))}
                        className="w-20 h-2 rounded-full appearance-none bg-muted/30 accent-primary"
                      />
                      <span className="text-2xs text-muted-foreground/60 font-mono tabular-nums w-8">
                        {ttsRate.toFixed(1)}x
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="ui-hero-surface p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success status-online" />
                <h3 className="section-label-sm">Packet Flow</h3>
                <span className="ml-auto text-2xs text-muted-foreground/60">
                  {packetLog.length > 0
                    ? `${new Set(packetLog.slice(-200).map((p) => p.source_ip)).size} sources`
                    : "Waiting..."}
                </span>
              </div>
              <PacketFlowCanvas packetLog={packetLog} />
            </div>

            <div className="ui-hero-surface p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success status-online" />
                <h3 className="section-label-sm">Throughput</h3>
                <span className="ml-auto text-2xs text-muted-foreground/60 tabular-nums">
                  {chartData.length > 0 ? `${chartData.length} samples` : "Collecting..."}
                </span>
              </div>
              <div className="h-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.15)" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }} width={36} />
                    <Tooltip
                      contentStyle={{
                        fontSize: 11,
                        background: "hsl(var(--card))",
                        border: "none",
                        borderRadius: 8,
                        boxShadow: "var(--shadow-card)",
                      }}
                      formatter={(val: unknown) => [`${typeof val === "number" ? val : "—"} pps`, "Packets/sec"]}
                    />
                    <Line type="monotone" dataKey="pps" stroke="hsl(var(--chart-1))" strokeWidth={1.6} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ PACKET LOG (collapsible, default collapsed) ═════════ */}
      {hasGroups && (
        <CollapsibleSection
          icon={<Radio className="h-3.5 w-3.5 text-muted-foreground/60" />}
          title="Packet Log"
          subtitle={`${packetLog.length} packets`}
          defaultOpen={false}
          action={<Button variant="ghost" size="sm" className="h-7 text-2xs" onClick={clearPacketLog}>Clear</Button>}
        >
          <div className="max-h-[240px] overflow-auto">
            {packetLog.length === 0 ? (
              <div className="p-6 text-center text-2xs text-muted-foreground/60">
                Listening for packets…
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left py-2 px-5 section-label-sm">Time</th>
                    <th className="text-left py-2 px-3 section-label-sm">Group</th>
                    <th className="text-left py-2 px-3 section-label-sm">Source</th>
                    <th className="text-right py-2 px-3 section-label-sm">Size</th>
                    <th className="text-right py-2 px-3 section-label-sm">TTL</th>
                  </tr>
                </thead>
                <tbody>
                  {[...packetLog].slice(-100).reverse().map((p, i) => (
                    <tr key={`${p.timestamp}-${i}`} className="border-b border-border/20 hover:bg-muted/10 transition-smooth">
                      <td className="py-1.5 px-5 font-mono text-2xs">{new Date(p.timestamp).toLocaleTimeString()}</td>
                      <td className="py-1.5 px-3 font-mono text-2xs">{p.group}</td>
                      <td className="py-1.5 px-3 font-mono text-2xs">{p.source_ip}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-2xs">{p.size}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-2xs">{p.ttl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* ═══ SEND TEST (collapsible, default collapsed) ══════════ */}
      {hasGroups && (
        <SendTestPanel
          targetGroup={targetGroup}
          testCount={testCount}
          setTestCount={setTestCount}
          testInterval={testInterval}
          setTestInterval={setTestInterval}
          testTtl={testTtl}
          setTestTtl={setTestTtl}
          testing={testing}
          sendTestState={sendTestState}
          onSend={handleSendTest}
        />
      )}
    </div>
  );
}

// ── Collapsible Section ──────────────────────────────────────────

function CollapsibleSection({
  icon,
  title,
  subtitle,
  defaultOpen = false,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="surface-flat overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-muted/10 transition-smooth"
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="section-label-sm">{title}</span>
        {subtitle && (
          <span className="text-2xs text-muted-foreground/60 ml-1 tabular-nums">{subtitle}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {open && action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
          {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/60" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />}
        </span>
      </button>
      {open && children}
    </div>
  );
}

// ── Send Test Panel (collapsible) ────────────────────────────────

function SendTestPanel({ targetGroup, testCount, setTestCount, testInterval, setTestInterval, testTtl, setTestTtl, testing, sendTestState, onSend }: {
  targetGroup: string;
  testCount: number; setTestCount: (n: number) => void;
  testInterval: number; setTestInterval: (n: number) => void;
  testTtl: number; setTestTtl: (n: number) => void;
  testing: boolean; sendTestState: { status: string; result: { sent: number; elapsed_ms: number } | null; error: string | null };
  onSend: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="surface-flat overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-muted/10 transition-smooth"
        onClick={() => setOpen((o) => !o)}
      >
        <Send className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="section-label-sm">Send Test Packets</span>
        <span className="text-2xs text-muted-foreground/60 ml-1">
          Send raw UDP packets to verify multicast delivery
        </span>
        <span className="ml-auto">
          {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/60" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-4 pt-0 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-2xs text-muted-foreground/60 font-medium mr-0.5">Count</span>
            {TEST_COUNTS.map((n) => (
              <button
                key={n} type="button"
                onClick={() => setTestCount(n)}
                disabled={testing}
                className={cn(
                  "h-7 w-10 rounded-lg text-2xs font-mono tabular-nums transition-smooth",
                  testCount === n
                    ? "bg-primary/15 text-primary font-medium ring-1 ring-primary/20"
                    : "bg-muted/10 text-muted-foreground/60 hover:bg-muted/20 hover:text-foreground",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-2xs text-muted-foreground/60 font-medium mr-0.5">Interval</span>
            {TEST_INTERVALS.map((ms) => (
              <button
                key={ms} type="button"
                onClick={() => setTestInterval(ms)}
                disabled={testing}
                className={cn(
                  "h-7 rounded-lg text-2xs font-mono px-2 transition-smooth",
                  testInterval === ms
                    ? "bg-primary/15 text-primary font-medium ring-1 ring-primary/20"
                    : "bg-muted/10 text-muted-foreground/60 hover:bg-muted/20 hover:text-foreground",
                )}
              >
                {ms}ms
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <TooltipWrapper entry={tooltips.netMcastTtl}>
              <span className="text-2xs text-muted-foreground/60 font-medium cursor-help">TTL</span>
            </TooltipWrapper>
            <Input
              type="number" value={testTtl}
              onChange={(e) => setTestTtl(parseInt(e.target.value, 10) || 32)}
              className="h-7 w-16 font-mono text-2xs"
              disabled={testing}
            />
          </div>
          <Button className="h-9 gap-2" onClick={onSend} disabled={testing || !targetGroup.trim()}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Send
          </Button>
          {sendTestState.status === "done" && sendTestState.result && (
            <span className="text-2xs text-muted-foreground">
              Sent {sendTestState.result.sent} in {sendTestState.result.elapsed_ms}ms
            </span>
          )}
          {sendTestState.status === "error" && sendTestState.error && (
            <span className="text-2xs text-destructive">{sendTestState.error}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Packet Flow Canvas ───────────────────────────────────────────

interface FlowParticle {
  x: number;
  y: number;
  speed: number;
  size: number;
  opacity: number;
  sourceIdx: number;
}

const FLOW_RAW_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#6d7bce"];

function PacketFlowCanvas({ packetLog }: { packetLog: MulticastPacketEvent[] }) {
  const flowRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<FlowParticle[]>([]);
  const animRef = useRef<number>(0);
  const lastCountRef = useRef(0);
  const sourcesRef = useRef<string[]>([]);

  useEffect(() => {
    const seen = new Set<string>();
    packetLog.slice(-200).forEach((p) => seen.add(p.source_ip));
    sourcesRef.current = Array.from(seen).slice(0, 6);
  }, [packetLog]);

  useEffect(() => {
    const diff = packetLog.length - lastCountRef.current;
    lastCountRef.current = packetLog.length;
    if (diff <= 0) return;

    const newP: FlowParticle[] = [];
    const recent = packetLog.slice(-Math.min(diff, 15));
    const srcCount = Math.max(sourcesRef.current.length, 1);

    for (const pkt of recent) {
      const idx = Math.max(0, sourcesRef.current.indexOf(pkt.source_ip));
      const laneH = 1.0 / (srcCount + 1);
      const yBase = laneH * (idx + 1);
      newP.push({
        x: 0,
        y: yBase + (Math.random() - 0.5) * laneH * 0.3,
        speed: 0.007 + Math.random() * 0.005,
        size: Math.min(Math.max(pkt.size / 250, 1.5), 5),
        opacity: 0.7 + Math.random() * 0.3,
        sourceIdx: idx,
      });
    }
    particlesRef.current = [...particlesRef.current, ...newP].slice(-150);
  }, [packetLog]);

  useEffect(() => {
    const canvas = flowRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const srcList = sourcesRef.current;
      const srcCount = Math.max(srcList.length, 1);
      const laneH = height / (srcCount + 1);

      ctx.font = "10px var(--font-mono, monospace)";
      ctx.textAlign = "left";
      srcList.forEach((src, i) => {
        const y = laneH * (i + 1);
        const color = FLOW_RAW_COLORS[i % FLOW_RAW_COLORS.length] ?? "#60a5fa";
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = color;
        ctx.fillText(src, 6, y + 3);
        ctx.beginPath();
        ctx.arc(6 + ctx.measureText(src).width + 8, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });

      ctx.fillStyle = "hsl(235, 14%, 70%)";
      ctx.globalAlpha = 0.5;
      ctx.textAlign = "right";
      ctx.fillText("● Listener", width - 6, height / 2 + 3);
      ctx.globalAlpha = 1;

      const alive: FlowParticle[] = [];
      for (const p of particlesRef.current) {
        p.x += p.speed;
        if (p.x > 1.0) continue;
        alive.push(p);

        const px = width * 0.22 + p.x * (width * 0.56);
        const py = p.y * height;
        const color = FLOW_RAW_COLORS[p.sourceIdx % FLOW_RAW_COLORS.length] ?? "#60a5fa";
        const fade = 1 - p.x * 0.4;

        ctx.globalAlpha = p.opacity * 0.12 * fade;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px - p.speed * width * 1.5, py, p.size * 1.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = p.opacity * fade;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      particlesRef.current = alive;
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <canvas
      ref={flowRef}
      width={600} height={120}
      className="w-full h-[120px] rounded-lg bg-muted/10 block"
    />
  );
}

// ═════════════════════════════════════════════════════════════════
// ══ IGMP DIAGNOSTICS TAB ════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════

function IgmpTab() {
  const igmpQuery = useMulticastStore((s) => s.igmpQuery);
  const snoopingVerify = useMulticastStore((s) => s.snoopingVerify);
  const lastSource = useMulticastStore((s) => s.lastSource);
  const selectedInterface = useMulticastStore((s) => s.selectedInterface);
  const setSelectedInterface = useMulticastStore((s) => s.setSelectedInterface);
  const targetGroup = useMulticastStore((s) => s.targetGroup);
  const setTargetGroup = useMulticastStore((s) => s.setTargetGroup);
  const runIgmpQuery = useMulticastStore((s) => s.runIgmpQuery);
  const runSnoopingVerify = useMulticastStore((s) => s.runSnoopingVerify);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ctx = resolvedContext("multicast");

  const sourceMap = lastSource as Record<string, { source: "local" | "remote"; agentId?: string } | undefined>;
  const igmpSource = sourceMap.igmpQuery;
  const snoopSource = sourceMap.snoopingVerify;
  const igmpAgentName = igmpSource?.source === "remote" ? resolvedAgentName("multicast") ?? undefined : undefined;
  const snoopAgentName = snoopSource?.source === "remote" ? resolvedAgentName("multicast") ?? undefined : undefined;

  const queryRunning = igmpQuery.status === "running";
  const snoopRunning = snoopingVerify.status === "running";
  const qResult = igmpQuery.result;
  const sResult = snoopingVerify.result;
  const localJoinedCount = qResult?.groups_found.filter((g) => g.last_reporter === "local-app").length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="ui-hero-surface overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-border/15">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="section-label-sm">IGMP Diagnostics</h3>
              <p className="text-2xs text-muted-foreground/70 mt-1">
                Two-step control-plane check: discover memberships, then validate snooping behavior.
              </p>
            </div>
            <TooltipWrapper
              title="What this verifies"
              description="Step 1 sends an IGMP query and reports memberships seen by responders. Step 2 tests join/leave timing and TTL boundary behavior for a target group."
              side="left"
            >
              <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help whitespace-nowrap">
                <Info className="h-3 w-3" />
                Accuracy notes
              </span>
            </TooltipWrapper>
          </div>
        </div>

        <div className="px-5 pb-4 space-y-4">
          <div className="ui-hero-surface border border-border/15 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-primary/60" />
                <span className="section-label-sm">1) Discover Active Memberships</span>
              </div>
              {qResult && <span className="text-2xs text-success">Completed</span>}
            </div>
            <p className="text-2xs text-muted-foreground/70 mb-3">
              Purpose: identify currently advertised multicast memberships on the selected interface.
            </p>
            <p className="text-2xs text-muted-foreground/60 mb-3">
              Expected output: groups, reporters, IGMP version, and query response time.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <InterfacePicker
                value={selectedInterface}
                onChange={setSelectedInterface}
                disabled={queryRunning}
              />
              <Button
                className="h-10 gap-2"
                onClick={() => runIgmpQuery(selectedInterface || undefined, ctx)}
                disabled={queryRunning}
              >
                {queryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Run Discovery
              </Button>
            </div>
            {igmpSource && (
              <ResultSourceBadge source={igmpSource.source} agentName={igmpAgentName} className="mt-3" />
            )}
            {qResult && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  <MetricCard label="Groups Found" value={qResult.groups_found.length} status={qResult.groups_found.length > 0 ? "pass" : "idle"} />
                  <MetricCard label="Responders" value={qResult.responders} />
                  <MetricCard label="Local Joined" value={localJoinedCount} status={localJoinedCount > 0 ? "pass" : "idle"} />
                  <MetricCard label="IGMP Version" value={`v${qResult.igmp_version}`} />
                  <MetricCard label="Query Time" value={qResult.query_time_ms} unit="ms" />
                </div>
                {qResult.groups_found.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="text-left py-2 px-3 section-label-sm">Group Address</th>
                        <th className="text-left py-2 px-3 section-label-sm">Last Reporter</th>
                        <th className="text-left py-2 px-3 section-label-sm">Version</th>
                        <th className="text-left py-2 px-3 section-label-sm">Compat Mode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qResult.groups_found.map((g) => (
                        <tr key={g.group} className="border-b border-border/20 hover:bg-muted/10 transition-smooth">
                          <td className="py-2 px-3 font-mono">{g.group}</td>
                          <td className="py-2 px-3 font-mono text-muted-foreground">{g.last_reporter}</td>
                          <td className="py-2 px-3 text-muted-foreground">v{g.igmp_version}</td>
                          <td className="py-2 px-3 text-muted-foreground/70">{g.compatibility_mode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-2 text-center text-2xs text-muted-foreground/60">
                    No multicast groups detected on this network segment.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ui-hero-surface border border-border/15 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-warning/60" />
                <span className="section-label-sm">2) Validate Snooping Health</span>
              </div>
              {sResult && <span className="text-2xs text-success">Completed</span>}
            </div>
            <p className="text-2xs text-muted-foreground/70 mb-3">
              Purpose: validate join/leave behavior and TTL-boundary filtering for one target group.
            </p>
            <p className="text-2xs text-muted-foreground/60 mb-3">
              Expected output: health verdict, latency, leave verification, and detailed step log.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={targetGroup}
                onChange={(e) => setTargetGroup(e.target.value)}
                placeholder="Target group (e.g. 239.255.0.1)"
                className="h-10 flex-1 max-w-[240px] font-mono"
                disabled={snoopRunning}
              />
              <Button
                className="h-10 gap-2"
                onClick={() => targetGroup.trim() && runSnoopingVerify(targetGroup.trim(), undefined, ctx)}
                disabled={snoopRunning || !targetGroup.trim()}
              >
                {snoopRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                Run Validation
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground/60 mt-2">
              Tip: run this for the same group you observed in Step 1 or a known production group.
            </p>
            {snoopSource && (
              <ResultSourceBadge source={snoopSource.source} agentName={snoopAgentName} className="mt-3" />
            )}
            {sResult && (
              <div className="mt-3">
                <div className={cn(
                  "rounded-lg p-4 mb-4 flex items-center gap-3",
                  sResult.snooping_active ? "bg-success/10" : "bg-destructive/10",
                )}>
                  <Shield className={cn("h-5 w-5", sResult.snooping_active ? "text-success" : "text-destructive")} />
                  <div>
                    <div className={cn("text-sm font-semibold", sResult.snooping_active ? "text-success" : "text-destructive")}>
                      {sResult.snooping_active ? "Snooping is Active" : "Snooping Not Detected"}
                    </div>
                    <div className="text-2xs text-muted-foreground/70 mt-0.5">
                      {sResult.snooping_active
                        ? "Your switch is correctly filtering multicast traffic to subscribed ports only."
                        : "Multicast traffic may be flooding all switch ports. Check your switch IGMP snooping configuration."}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  <MetricCard label="Join Latency" value={sResult.join_latency_ms} unit="ms" />
                  <MetricCard label="Leave Verified" value={sResult.leave_verified ? "Yes" : "No"} status={sResult.leave_verified ? "pass" : "warn"} />
                  <MetricCard label="TTL Filtering" value={sResult.ttl_check ? "Pass" : "Fail"} status={sResult.ttl_check ? "pass" : "fail"} />
                  <MetricCard label="Overall" value={sResult.snooping_active ? "Healthy" : "Failing"} status={sResult.snooping_active ? "pass" : "fail"} />
                </div>

                {sResult.details && sResult.details.length > 0 && (
                  <div className="ui-hero-surface p-3 space-y-1.5">
                    <h4 className="section-label-sm mb-1">Verification Steps</h4>
                    {sResult.details.map((d, i) => {
                      const lower = d.toLowerCase();
                      const isStep = lower.startsWith("step ");
                      const isFail = lower.includes("fail") || lower.includes("error") || lower.includes("timeout") || lower.includes("no response");
                      return (
                        <div key={i} className={cn("flex items-start gap-2 text-2xs", isStep && "mt-1")}>
                          {isStep ? (
                            <span className="mt-0.5 shrink-0 text-muted-foreground/60">●</span>
                          ) : isFail ? (
                            <span className="mt-0.5 shrink-0 text-destructive">✗</span>
                          ) : (
                            <span className="mt-0.5 shrink-0 text-success">✓</span>
                          )}
                          <span className={cn(
                            isStep ? "text-foreground/70 font-medium" : "text-muted-foreground",
                          )}>{d}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!sResult.snooping_active && (
                  <div className="mt-4 rounded-lg bg-warning/10 p-3 text-2xs text-warning/90">
                    <strong>Recommendation:</strong> Enable IGMP snooping on your network switch.
                    Check the switch management interface for IGMP/MLD snooping settings.
                    Ensure the snooping querier is configured for the relevant VLAN.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
