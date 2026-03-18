/**
 * BarSpectrum — luminous left/right frequency bars.
 *
 * Emerald bars (you) grow upward on the LEFT half, blue bars (them)
 * grow upward on the RIGHT half. Multi-stop gradient fills shift toward
 * accent hues at high energy. Temporal lerp on all bar heights for
 * buttery-smooth transitions. Round-capped rendering throughout.
 */

import { useRef, useLayoutEffect, useCallback } from "react";
import {
  YOU_RGB, THEM_RGB, YOU_ACCENT, THEM_ACCENT,
  rms, lerp, lerpRgb, rgba, setupCanvas,
  type VisualizerProps,
} from "./viz-shared";

const BARS = 16;
const DECAY = 0.86;
const BAR_GAP_RATIO = 0.62;
const TEMPORAL_LERP = 0.16;
const TARGET_FPS = 45;

export function BarSpectrum({ waveformRef, className, style }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<{
    send: Float64Array; recv: Float64Array;
    sendSmooth: Float64Array; recvSmooth: Float64Array;
  } | null>(null);
  const smoothEnergyRef = useRef({ send: 0, recv: 0 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = container.getBoundingClientRect();
    const cw = Math.max(200, Math.floor(rect.width * dpr));
    const ch = Math.max(80, Math.floor(rect.height * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    setupCanvas(g);

    if (!barsRef.current) {
      barsRef.current = {
        send: new Float64Array(BARS),
        recv: new Float64Array(BARS),
        sendSmooth: new Float64Array(BARS),
        recvSmooth: new Float64Array(BARS),
      };
    }
    const bars = barsRef.current;

    const w = cw;
    const h = ch;
    const midX = w / 2;
    const wf = waveformRef.current;
    const sendSamples = wf?.send ?? [];
    const recvSamples = wf?.recv ?? [];
    const rawSendE = rms(sendSamples);
    const rawRecvE = rms(recvSamples);

    const se = smoothEnergyRef.current;
    se.send = lerp(se.send, rawSendE, TEMPORAL_LERP);
    se.recv = lerp(se.recv, rawRecvE, TEMPORAL_LERP);
    const sendE = se.send;
    const recvE = se.recv;

    const sendColor = lerpRgb(YOU_RGB, YOU_ACCENT, Math.min(1, sendE * 3));
    const recvColor = lerpRgb(THEM_RGB, THEM_ACCENT, Math.min(1, recvE * 3));

    const updateBars = (
      samples: number[], energy: number,
      target: Float64Array, smooth: Float64Array,
    ) => {
      if (samples.length === 0) {
        for (let i = 0; i < BARS; i++) {
          target[i] = target[i]! * DECAY;
        }
      } else {
        const chunk = Math.max(1, Math.floor(samples.length / BARS));
        const tNow = performance.now() * 0.001;
        for (let b = 0; b < BARS; b++) {
          let sum = 0;
          let peak = 0;
          const start = b * chunk;
          const end = Math.min(start + chunk, samples.length);
          for (let i = start; i < end; i++) {
            const a = Math.abs(samples[i]!);
            sum += a;
            if (a > peak) peak = a;
          }
          const avg = sum / Math.max(1, end - start);
          const bNorm = b / Math.max(1, BARS - 1);
          // Band shaping + low-amplitude ripple improve neighboring bar distinction.
          const bandShape =
            0.82 +
            bNorm * 0.2 +
            Math.sin(bNorm * Math.PI * 2.2 + tNow * 0.55) * 0.08;
          const ripple = (Math.sin(tNow * 1.9 + b * 1.43) * 0.5 + 0.5) * 0.05;
          const composite = (avg * 0.62 + peak * 0.38 + ripple) * bandShape;
          const gain = 0.9 + energy * 4.2;
          const val = Math.min(1, Math.pow(composite * gain * 1.9, 0.88));
          target[b] = Math.max(target[b]! * DECAY, val);
        }
      }
      for (let i = 0; i < BARS; i++) {
        smooth[i] = lerp(smooth[i]!, target[i]!, TEMPORAL_LERP);
      }
    };

    updateBars(sendSamples, sendE, bars.send, bars.sendSmooth);
    updateBars(recvSamples, recvE, bars.recv, bars.recvSmooth);

    g.clearRect(0, 0, w, h);

    // Ambient radial glows
    {
      const a = 0.05 + Math.min(0.15, sendE * 0.6);
      const gr = g.createRadialGradient(w * 0.25, h * 0.5, 0, w * 0.25, h * 0.5, w * 0.42);
      gr.addColorStop(0, rgba(sendColor, a));
      gr.addColorStop(0.5, rgba(YOU_RGB, a * 0.25));
      gr.addColorStop(1, rgba(YOU_RGB, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    {
      const a = 0.05 + Math.min(0.15, recvE * 0.6);
      const gr = g.createRadialGradient(w * 0.75, h * 0.5, 0, w * 0.75, h * 0.5, w * 0.42);
      gr.addColorStop(0, rgba(recvColor, a));
      gr.addColorStop(0.5, rgba(THEM_RGB, a * 0.25));
      gr.addColorStop(1, rgba(THEM_RGB, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }

    const padding = 8 * dpr;
    const halfW = midX - padding;
    const barW = halfW / BARS / (1 + BAR_GAP_RATIO);
    const gap = barW * BAR_GAP_RATIO;
    const maxBarH = h * 0.62;
    const baseY = h - 10 * dpr;
    const radius = Math.min(4 * dpr, barW / 2);

    const drawBars = (
      data: Float64Array,
      base: readonly [number, number, number],
      color: [number, number, number],
      accent: [number, number, number],
      offsetX: number,
    ) => {
      const groupW = BARS * (barW + gap) - gap;
      const groupStart = offsetX + (halfW - groupW) / 2;

      for (let b = 0; b < BARS; b++) {
        const x = groupStart + b * (barW + gap);
        const val = data[b]!;
        const ambient = 0.006 + Math.sin(performance.now() * 0.0008 + b * 0.4) * 0.004;
        const vis = Math.max(ambient, val);
        const barH = vis * maxBarH;
        if (barH < 0.5) continue;

        const y = baseY - barH;
        // Main bar body — stronger opacity for a more solid read.
        g.globalCompositeOperation = "source-over";
        const fillGrad = g.createLinearGradient(x, baseY, x, baseY - maxBarH);
        fillGrad.addColorStop(0, rgba(base, 0.34 + vis * 0.32));
        fillGrad.addColorStop(0.45, rgba(color, 0.28 + vis * 0.28));
        fillGrad.addColorStop(0.82, rgba(accent, 0.18 + vis * 0.18));
        fillGrad.addColorStop(1, rgba(accent, 0.12 + vis * 0.1));
        g.fillStyle = fillGrad;
        g.beginPath();
        g.roundRect(x, y, barW, barH, radius);
        g.fill();

        // Crisp outer edge to make bar boundaries clean and legible.
        g.strokeStyle = rgba(lerpRgb(base, accent, 0.35), Math.min(0.65, 0.24 + vis * 0.65));
        g.lineWidth = Math.max(1, 1.05 * dpr);
        g.beginPath();
        g.roundRect(x, y, barW, barH, radius);
        g.stroke();

        // No halo/peak dots: keep bars clean and solid.
      }
    };

    const sendAccent = lerpRgb(YOU_RGB, YOU_ACCENT, 0.5);
    const recvAccent = lerpRgb(THEM_RGB, THEM_ACCENT, 0.5);

    drawBars(bars.sendSmooth, YOU_RGB, sendColor, sendAccent, padding);
    drawBars(bars.recvSmooth, THEM_RGB, recvColor, recvAccent, midX + padding);

    // Center divider glow
    g.globalCompositeOperation = "lighter";
    const divGrad = g.createLinearGradient(midX - 5 * dpr, 0, midX + 5 * dpr, 0);
    divGrad.addColorStop(0, "rgba(255,255,255,0)");
    divGrad.addColorStop(0.5, "rgba(255,255,255,0.035)");
    divGrad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = divGrad;
    g.fillRect(midX - 5 * dpr, h * 0.08, 10 * dpr, h * 0.84);

    g.globalCompositeOperation = "source-over";
    g.strokeStyle = "rgba(255,255,255,0.04)";
    g.lineWidth = 1 * dpr;
    g.setLineDash([4 * dpr, 10 * dpr]);
    g.beginPath();
    g.moveTo(midX, h * 0.08);
    g.lineTo(midX, h * 0.92);
    g.stroke();
    g.setLineDash([]);
  }, [waveformRef]);

  useLayoutEffect(() => {
    let rafId: number;
    let last = 0;
    const frameMs = 1000 / TARGET_FPS;
    const loop = (now: number) => {
      if (now - last >= frameMs) {
        draw();
        last = now;
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [draw]);

  return (
    <div ref={containerRef} className={className} style={style}>
      <canvas ref={canvasRef} className="block w-full h-full" style={{ width: "100%", height: "100%" }} aria-label="Bar spectrum" />
    </div>
  );
}
