/**
 * WaveformRibbon — luminous dual-channel oscilloscope.
 *
 * Two glowing waveform ribbons mirrored around a horizontal center axis.
 * Emerald (you) flows above, blue (them) flows below. Multi-stop gradients
 * shift toward cyan/violet at high energy. Temporal lerp smooths all motion.
 */

import { useRef, useLayoutEffect, useCallback } from "react";
import {
  YOU_RGB, THEM_RGB, YOU_ACCENT, THEM_ACCENT,
  rms, lerp, lerpRgb, rgba, setupCanvas,
  type VisualizerProps,
} from "./viz-shared";

const POINTS = 128;
const SMOOTHING = 0.35;
const BREATH_SPEED = 0.0006;
const BREATH_AMP = 0.03;
const TEMPORAL_LERP = 0.14;
const TARGET_FPS = 45;

export function WaveformRibbon({ waveformRef, className, style }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const smoothedRef = useRef<{ send: Float64Array; recv: Float64Array } | null>(null);
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

    if (!smoothedRef.current) {
      smoothedRef.current = {
        send: new Float64Array(POINTS),
        recv: new Float64Array(POINTS),
      };
    }
    const sm = smoothedRef.current;

    const w = cw;
    const h = ch;
    const midY = h / 2;
    const wf = waveformRef.current;
    const sendSamples = wf?.send ?? [];
    const recvSamples = wf?.recv ?? [];
    const rawSendE = rms(sendSamples);
    const rawRecvE = rms(recvSamples);
    const now = performance.now();

    const se = smoothEnergyRef.current;
    se.send = lerp(se.send, rawSendE, TEMPORAL_LERP);
    se.recv = lerp(se.recv, rawRecvE, TEMPORAL_LERP);
    const sendE = se.send;
    const recvE = se.recv;

    g.clearRect(0, 0, w, h);

    const sendColor = lerpRgb(YOU_RGB, YOU_ACCENT, Math.min(1, sendE * 3));
    const recvColor = lerpRgb(THEM_RGB, THEM_ACCENT, Math.min(1, recvE * 3));

    // Ambient radial glows
    const drawAmbient = (
      cx: number, cy: number, radius: number,
      rgb: readonly [number, number, number] | [number, number, number],
      energy: number,
    ) => {
      const a = 0.05 + Math.min(0.18, energy * 0.6);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gr.addColorStop(0, rgba(rgb, a));
      gr.addColorStop(0.5, rgba(rgb, a * 0.3));
      gr.addColorStop(1, rgba(rgb, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    };
    drawAmbient(w * 0.35, h * 0.25, w * 0.55, sendColor, sendE);
    drawAmbient(w * 0.65, h * 0.75, w * 0.55, recvColor, recvE);

    // Build and temporally smooth point arrays
    const buildPoints = (
      samples: number[], energy: number, target: Float64Array,
    ): Float64Array => {
      const maxAmp = h * 0.58;
      for (let i = 0; i < POINTS; i++) {
        const t = i / (POINTS - 1);
        let val = 0;
        if (samples.length > 0) {
          const idx = Math.floor(t * (samples.length - 1));
          val = (samples[idx] ?? 0) * Math.min(1, energy * 9.5 + 0.2);
        }
        if (energy < 0.02) {
          val += Math.sin(now * BREATH_SPEED + t * Math.PI * 4) * BREATH_AMP;
        }
        const raw = val * maxAmp;
        target[i] = lerp(target[i]!, raw, TEMPORAL_LERP);
      }
      // Spatial smoothing passes
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < POINTS - 1; i++) {
          target[i] = target[i]! * (1 - SMOOTHING) + ((target[i - 1]! + target[i + 1]!) / 2) * SMOOTHING;
        }
      }
      return target;
    };

    buildPoints(sendSamples, sendE, sm.send);
    buildPoints(recvSamples, recvE, sm.recv);

    const tracePath = (pts: Float64Array, above: boolean) => {
      const step = w / (POINTS - 1);
      g.beginPath();
      g.moveTo(0, midY);
      for (let i = 0; i < POINTS; i++) {
        const x = i * step;
        const y = midY + (above ? -Math.abs(pts[i]!) : Math.abs(pts[i]!));
        if (i === 0) {
          g.lineTo(x, y);
        } else {
          const prevX = (i - 1) * step;
          const prevY = midY + (above ? -Math.abs(pts[i - 1]!) : Math.abs(pts[i - 1]!));
          const cpx = (prevX + x) / 2;
          g.bezierCurveTo(cpx, prevY, cpx, y, x, y);
        }
      }
    };

    // Filled ribbons with multi-stop gradients
    const drawFill = (
      pts: Float64Array,
      rgb: readonly [number, number, number] | [number, number, number],
      accent: [number, number, number],
      energy: number, above: boolean,
    ) => {
      tracePath(pts, above);
      g.lineTo(w, midY);
      g.closePath();
      const grad = g.createLinearGradient(0, above ? 0 : midY, 0, above ? midY : h);
      const a = Math.min(0.55, 0.1 + energy * 2.5);
      grad.addColorStop(above ? 0 : 1, rgba(accent, a * 0.6));
      grad.addColorStop(above ? 0.4 : 0.6, rgba(rgb, a * 0.4));
      grad.addColorStop(above ? 1 : 0, rgba(rgb, 0.01));
      g.fillStyle = grad;
      g.fill();
    };

    drawFill(sm.send, sendColor, lerpRgb(YOU_RGB, YOU_ACCENT, 0.6), sendE, true);
    drawFill(sm.recv, recvColor, lerpRgb(THEM_RGB, THEM_ACCENT, 0.6), recvE, false);

    // Luminous glow strokes (additive)
    g.globalCompositeOperation = "lighter";

    const drawGlowLine = (
      pts: Float64Array,
      rgb: readonly [number, number, number] | [number, number, number],
      accent: [number, number, number],
      energy: number, above: boolean,
    ) => {
      // Wide diffuse glow
      tracePath(pts, above);
      g.strokeStyle = rgba(rgb, Math.min(0.25, 0.04 + energy * 1.2));
      g.lineWidth = 10 * dpr;
      g.stroke();

      // Medium colored glow
      tracePath(pts, above);
      g.strokeStyle = rgba(accent, Math.min(0.4, 0.08 + energy * 1.8));
      g.lineWidth = 4 * dpr;
      g.stroke();

      // Sharp bright core
      tracePath(pts, above);
      const coreA = Math.min(0.9, 0.25 + energy * 4);
      g.strokeStyle = rgba(rgb, coreA);
      g.lineWidth = 1.5 * dpr;
      g.stroke();

      // White-hot center
      tracePath(pts, above);
      g.strokeStyle = rgba([255, 255, 255], coreA * 0.45);
      g.lineWidth = 0.6 * dpr;
      g.stroke();
    };

    drawGlowLine(sm.send, sendColor, lerpRgb(YOU_RGB, YOU_ACCENT, 0.5), sendE, true);
    drawGlowLine(sm.recv, recvColor, lerpRgb(THEM_RGB, THEM_ACCENT, 0.5), recvE, false);

    g.globalCompositeOperation = "source-over";

    // Center line
    g.strokeStyle = "rgba(255,255,255,0.04)";
    g.lineWidth = 1 * dpr;
    g.beginPath();
    g.moveTo(0, midY);
    g.lineTo(w, midY);
    g.stroke();
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
      <canvas ref={canvasRef} className="block w-full h-full" style={{ width: "100%", height: "100%" }} aria-label="Waveform ribbon" />
    </div>
  );
}
