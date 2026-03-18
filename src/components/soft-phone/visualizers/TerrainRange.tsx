/**
 * TerrainRange — luminous topographic mountain range.
 *
 * Layered glowing terrain rises from bottom (emerald/you) and descends
 * from top (blue/them). Multi-stop gradient fills shift toward accent
 * hues at high energy. Temporal lerp on all layer values for smooth
 * animation. Clean bezier curves and round line caps.
 */

import { useRef, useLayoutEffect, useCallback } from "react";
import {
  YOU_RGB, THEM_RGB, YOU_ACCENT, THEM_ACCENT,
  rms, lerp, lerpRgb, rgba, setupCanvas,
  type VisualizerProps,
} from "./viz-shared";

const LAYERS = 4;
const RESOLUTION = 64;
const DECAY = 0.89;
const TEMPORAL_LERP = 0.13;
const TARGET_FPS = 45;

export function TerrainRange({ waveformRef, className, style }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<{ send: Float64Array[]; recv: Float64Array[] } | null>(null);
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

    if (!layersRef.current) {
      layersRef.current = {
        send: Array.from({ length: LAYERS }, () => new Float64Array(RESOLUTION)),
        recv: Array.from({ length: LAYERS }, () => new Float64Array(RESOLUTION)),
      };
    }
    const layers = layersRef.current;

    const w = cw;
    const h = ch;
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

    const sendColor = lerpRgb(YOU_RGB, YOU_ACCENT, Math.min(1, sendE * 3));
    const recvColor = lerpRgb(THEM_RGB, THEM_ACCENT, Math.min(1, recvE * 3));

    const updateLayers = (samples: number[], energy: number, layerData: Float64Array[]) => {
      const tNow = now * 0.001;
      for (let L = 0; L < LAYERS; L++) {
        const layer = layerData[L]!;
        const scale = 0.3 + (L / LAYERS) * 0.7;
        const offset = L * 0.6;
        for (let i = 0; i < RESOLUTION; i++) {
          const t = i / (RESOLUTION - 1);
          const tEdge = Math.min(t, 1 - t);
          let val = 0;
          if (samples.length > 0) {
            const idx = Math.floor(t * (samples.length - 1));
            val = Math.abs(samples[idx] ?? 0);
          }
          // Multi-frequency contour shaping adds richer peaks/valleys.
          const contour =
            Math.sin(t * Math.PI * 3.2 + tNow * 0.32 + offset) * 0.03 +
            Math.sin(t * Math.PI * 7.4 + tNow * 0.24 + offset * 1.7) * 0.018 +
            Math.sin(t * Math.PI * 12.8 + tNow * 0.16 + offset * 2.4) * 0.012;
          const ridgeBoost = (0.5 - tEdge) * 0.08; // slightly higher relief toward edges
          val += contour + ridgeBoost;
          const target = Math.min(1, Math.max(0, val * scale * Math.min(2.1, energy * 10.5 + 0.16)));
          const raw = Math.max(layer[i]! * DECAY, target);
          const layerLerp = L === 0 ? TEMPORAL_LERP * 1.12 : TEMPORAL_LERP;
          layer[i] = lerp(layer[i]!, raw, layerLerp);
        }
      }
    };

    updateLayers(sendSamples, sendE, layers.send);
    updateLayers(recvSamples, recvE, layers.recv);

    g.clearRect(0, 0, w, h);

    // Ambient radial glows
    {
      const a = 0.05 + Math.min(0.16, sendE * 0.6);
      const gr = g.createRadialGradient(w * 0.5, h, 0, w * 0.5, h, h * 0.85);
      gr.addColorStop(0, rgba(sendColor, a));
      gr.addColorStop(0.4, rgba(YOU_RGB, a * 0.3));
      gr.addColorStop(1, rgba(YOU_RGB, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    {
      const a = 0.05 + Math.min(0.16, recvE * 0.6);
      const gr = g.createRadialGradient(w * 0.5, 0, 0, w * 0.5, 0, h * 0.85);
      gr.addColorStop(0, rgba(recvColor, a));
      gr.addColorStop(0.4, rgba(THEM_RGB, a * 0.3));
      gr.addColorStop(1, rgba(THEM_RGB, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }

    const buildPath = (layer: Float64Array, maxH: number, depthFactor: number, fromBottom: boolean) => {
      const step = w / (RESOLUTION - 1);
      const baseY = fromBottom ? h : 0;
      g.beginPath();
      g.moveTo(0, baseY);
      for (let i = 0; i < RESOLUTION; i++) {
        const x = i * step;
        const amp = layer[i]! * maxH * depthFactor;
        const y = fromBottom ? baseY - amp : baseY + amp;
        if (i === 0) {
          g.lineTo(x, y);
        } else {
          const px = (i - 1) * step;
          const pAmp = layer[i - 1]! * maxH * depthFactor;
          const py = fromBottom ? baseY - pAmp : baseY + pAmp;
          const cpx = (px + x) / 2;
          g.bezierCurveTo(cpx, py, cpx, y, x, y);
        }
      }
      g.lineTo(w, baseY);
      g.closePath();
    };

    const drawTerrain = (
      layerData: Float64Array[],
      base: readonly [number, number, number],
      color: [number, number, number],
      accent: [number, number, number],
      fromBottom: boolean,
    ) => {
      const maxH = h * 0.48;
      const midY = h / 2;

      for (let L = LAYERS - 1; L >= 0; L--) {
        const layer = layerData[L]!;
        const depthFactor = 0.3 + (L / LAYERS) * 0.7;
        const layerBlend = L / LAYERS;
        const layerColor = lerpRgb(base, accent, layerBlend * 0.5);

        // Filled region with multi-stop gradient
        buildPath(layer, maxH, depthFactor, fromBottom);
        const grad = g.createLinearGradient(0, fromBottom ? h : 0, 0, midY);
        const fillA = 0.05 + depthFactor * 0.14;
        grad.addColorStop(0, rgba(layerColor, fillA));
        grad.addColorStop(0.4, rgba(color, fillA * 0.5));
        grad.addColorStop(1, rgba(base, 0.005));
        g.fillStyle = grad;
        g.fill();

        // Luminous glow contour (additive) — front layers only
        if (L <= 1) {
          g.globalCompositeOperation = "lighter";
          const step = w / (RESOLUTION - 1);
          const baseY = fromBottom ? h : 0;

          const traceLine = () => {
            g.beginPath();
            for (let i = 0; i < RESOLUTION; i++) {
              const x = i * step;
              const amp = layer[i]! * maxH * depthFactor;
              const y = fromBottom ? baseY - amp : baseY + amp;
              if (i === 0) {
                g.moveTo(x, y);
              } else {
                const px = (i - 1) * step;
                const pAmp = layer[i - 1]! * maxH * depthFactor;
                const py = fromBottom ? baseY - pAmp : baseY + pAmp;
                const cpx = (px + x) / 2;
                g.bezierCurveTo(cpx, py, cpx, y, x, y);
              }
            }
          };

          // Wide glow
          traceLine();
          const glowA = L === 0 ? 0.14 : 0.07;
          g.strokeStyle = rgba(color, glowA);
          g.lineWidth = (L === 0 ? 7 : 4) * dpr;
          g.stroke();

          // Core line with accent shift
          traceLine();
          const lineA = L === 0 ? 0.55 : 0.22;
          g.strokeStyle = rgba(L === 0 ? accent : color, lineA);
          g.lineWidth = (L === 0 ? 1.8 : 0.9) * dpr;
          g.stroke();

          // White-hot on front-most layer
          if (L === 0) {
            traceLine();
            g.strokeStyle = rgba([255, 255, 255], 0.18);
            g.lineWidth = 0.5 * dpr;
            g.stroke();
          }

          g.globalCompositeOperation = "source-over";
        }
      }
    };

    const sendAccent = lerpRgb(YOU_RGB, YOU_ACCENT, 0.5);
    const recvAccent = lerpRgb(THEM_RGB, THEM_ACCENT, 0.5);

    drawTerrain(layers.send, YOU_RGB, sendColor, sendAccent, true);
    drawTerrain(layers.recv, THEM_RGB, recvColor, recvAccent, false);
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
      <canvas ref={canvasRef} className="block w-full h-full" style={{ width: "100%", height: "100%" }} aria-label="Terrain range" />
    </div>
  );
}
