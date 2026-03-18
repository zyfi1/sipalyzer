import { useEffect, useRef } from "react";

/**
 * Ringtone presets — uses amplitude modulation (LFO) for the characteristic
 * phone-ring warble instead of flat tones that sound like dial/ringback signals.
 *
 *  - "default"  Electronic ring: 880+1108 Hz warbled at 20 Hz, 1s on / 3s off
 *  - "classic"  Mechanical bell:  700+900 Hz warbled at 16 Hz, 0.8s on / 0.4s off / 0.8s on / 4s off
 *  - "soft"     Gentle chime:    1047 Hz pulsed at 8 Hz, 0.5s on / 2.5s off
 *  - "silent"   No sound at all
 */

export interface RingtoneConfig {
  freq1: number;
  freq2: number | null;
  volume: number;
  lfoRate: number;
  lfoDepth: number;
  waveform: OscillatorType;
  /** Burst pattern: array of [onMs, offMs] pairs per cycle */
  bursts: [number, number][];
  /** Total cycle length including trailing silence */
  cycleMs: number;
}

export const RINGTONE_PRESETS: Record<string, RingtoneConfig> = {
  default: {
    freq1: 880, freq2: 1108, volume: 0.22, lfoRate: 20, lfoDepth: 0.9,
    waveform: "sine", bursts: [[1000, 0]], cycleMs: 4000,
  },
  classic: {
    freq1: 700, freq2: 900, volume: 0.20, lfoRate: 16, lfoDepth: 0.85,
    waveform: "sine", bursts: [[800, 400], [800, 0]], cycleMs: 6000,
  },
  soft: {
    freq1: 1047, freq2: null, volume: 0.14, lfoRate: 8, lfoDepth: 0.6,
    waveform: "sine", bursts: [[500, 0]], cycleMs: 3000,
  },
};

/**
 * Build the audio graph for a ringtone preset.
 * Returns a cleanup function and a playBurst callback.
 */
export function createRingtoneGraph(ctx: AudioContext, config: RingtoneConfig) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(ctx.destination);

  // LFO → lfoGain modulates the signal amplitude to create the warble
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0;
  lfoGain.connect(masterGain);

  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = config.lfoRate;

  const lfoAmplitude = ctx.createGain();
  lfoAmplitude.gain.value = config.lfoDepth * config.volume;
  lfo.connect(lfoAmplitude);
  lfoAmplitude.connect(masterGain.gain);
  lfo.start(0);

  const osc1 = ctx.createOscillator();
  osc1.type = config.waveform;
  osc1.frequency.value = config.freq1;
  osc1.connect(lfoGain);
  osc1.start(0);

  const oscs: OscillatorNode[] = [osc1, lfo];

  if (config.freq2 != null) {
    const osc2 = ctx.createOscillator();
    osc2.type = config.waveform;
    osc2.frequency.value = config.freq2;
    osc2.connect(lfoGain);
    osc2.start(0);
    oscs.push(osc2);
  }

  const baseGain = config.volume * (1 - config.lfoDepth);

  const startTone = () => {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setTargetAtTime(baseGain, ctx.currentTime, 0.01);
    lfoGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
  };

  const stopTone = () => {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
    lfoGain.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
  };

  const destroy = () => {
    stopTone();
    oscs.forEach((o) => { try { o.stop(); o.disconnect(); } catch { /* */ } });
    try { lfoGain.disconnect(); } catch { /* */ }
    try { lfoAmplitude.disconnect(); } catch { /* */ }
    try { masterGain.disconnect(); } catch { /* */ }
  };

  return { startTone, stopTone, destroy };
}

/**
 * Plays a ringtone while `isRinging` is true. Respects the `preset` setting:
 * "silent" or unknown presets produce no sound.
 */
export function useIncomingRingtone(isRinging: boolean, preset: string = "default") {
  const ctxRef = useRef<AudioContext | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const graphRef = useRef<ReturnType<typeof createRingtoneGraph> | null>(null);

  useEffect(() => {
    const cleanup = () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      graphRef.current?.destroy();
      graphRef.current = null;
      if (ctxRef.current?.state !== "closed") { ctxRef.current?.close().catch(() => {}); }
      ctxRef.current = null;
    };

    const config = RINGTONE_PRESETS[preset];
    if (!isRinging || !config) { cleanup(); return; }

    let ctx: AudioContext;
    try { ctx = new AudioContext(); } catch { return; }
    ctxRef.current = ctx;

    const graph = createRingtoneGraph(ctx, config);
    graphRef.current = graph;

    const playBurstSequence = () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      let offset = 0;
      for (const [onMs, offMs] of config.bursts) {
        const startAt = offset;
        const stopAt = offset + onMs;
        timersRef.current.push(setTimeout(() => graph.startTone(), startAt));
        timersRef.current.push(setTimeout(() => graph.stopTone(), stopAt));
        offset = stopAt + offMs;
      }
    };

    playBurstSequence();
    intervalRef.current = setInterval(playBurstSequence, config.cycleMs);

    return cleanup;
  }, [isRinging, preset]);
}
