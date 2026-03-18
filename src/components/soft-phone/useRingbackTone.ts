import { useEffect, useRef } from "react";

/** US-style ringback: 440Hz + 480Hz, 1s on / 2s off, audible volume. */
export function useRingbackTone(isRinging: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const oscRefs = useRef<OscillatorNode[]>([]);

  useEffect(() => {
    if (!isRinging) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (gainRef.current) {
        try {
          gainRef.current.gain.setValueAtTime(0, (ctxRef.current?.currentTime ?? 0));
        } catch {
          /* already disconnected */
        }
        gainRef.current = null;
      }
      oscRefs.current.forEach((osc) => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          /* ignore */
        }
      });
      oscRefs.current = [];
      if (ctxRef.current?.state !== "closed") {
        ctxRef.current?.close();
      }
      ctxRef.current = null;
      return;
    }

    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    ctxRef.current = ctx;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    gainRef.current = gain;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = "sine";
    osc2.type = "sine";
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;
    osc1.connect(gain);
    osc2.connect(gain);
    osc1.start(0);
    osc2.start(0);
    oscRefs.current = [osc1, osc2];

    const startTone = () => {
      if (gain.gain) gain.gain.setTargetAtTime(0.22, ctx.currentTime, 0.02);
    };
    const stopTone = () => {
      if (gain.gain) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    };

    startTone();
    timeoutRef.current = setTimeout(() => stopTone(), 1000);
    intervalRef.current = setInterval(() => {
      startTone();
      setTimeout(() => stopTone(), 1000);
    }, 3000);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      stopTone();
      oscRefs.current.forEach((osc) => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          /* ignore */
        }
      });
      oscRefs.current = [];
      gain.disconnect();
      gainRef.current = null;
      if (ctxRef.current?.state !== "closed") {
        ctxRef.current?.close();
      }
      ctxRef.current = null;
    };
  }, [isRinging]);
}
