/**
 * FrequencyAurora — realistic northern-lights curtain visualization.
 *
 * Flowing luminous curtains undulate across the canvas. Emerald/cyan
 * curtains drape from the top (you), blue/violet curtains rise from
 * the bottom (them). Each curtain uses a single continuous bezier path
 * (no column seams). Vertical ray structures and layered gradients
 * create realistic depth. Audio energy drives height and color shifts.
 */

import { useRef, useLayoutEffect, useCallback } from "react";
import {
  YOU_RGB, THEM_RGB, YOU_ACCENT, THEM_ACCENT,
  rms, lerp, lerpRgb, rgba, setupCanvas,
  type VisualizerProps,
} from "./viz-shared";

const CURTAIN_LAYERS = 3;
const POINTS = 120;
const TEMPORAL_LERP = 0.1;
const TARGET_FPS = 42;

export function FrequencyAurora({ waveformRef, className, style }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const smoothEnergyRef = useRef({ send: 0, recv: 0 });
  const curtainRef = useRef<{ send: Float64Array[]; recv: Float64Array[] } | null>(null);

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
      curtainRef.current = null;
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    setupCanvas(g);

    if (!curtainRef.current) {
      curtainRef.current = {
        send: Array.from({ length: CURTAIN_LAYERS }, () => new Float64Array(POINTS)),
        recv: Array.from({ length: CURTAIN_LAYERS }, () => new Float64Array(POINTS)),
      };
    }
    const curtains = curtainRef.current;

    const w = cw;
    const h = ch;
    const midY = h / 2;
    const wf = waveformRef.current;
    const now = performance.now() / 1000;

    const rawSendE = rms(wf?.send ?? []);
    const rawRecvE = rms(wf?.recv ?? []);
    const se = smoothEnergyRef.current;
    se.send = lerp(se.send, rawSendE, TEMPORAL_LERP);
    se.recv = lerp(se.recv, rawRecvE, TEMPORAL_LERP);

    g.clearRect(0, 0, w, h);

    // Generate curtain heights per layer
    const generateCurtain = (
      layers: Float64Array[],
      energy: number,
      samples: number[],
      phaseShift: number,
    ) => {
      for (let L = 0; L < CURTAIN_LAYERS; L++) {
        const layer = layers[L]!;
        const layerPhase = L * 1.3 + phaseShift;
        const speed = 0.15 + L * 0.08;
        const waveScale = 0.75 + L * 0.25;

        for (let i = 0; i < POINTS; i++) {
          const t = i / (POINTS - 1);

          let curtainH = 0;
          curtainH += Math.sin(t * Math.PI * 2.5 + now * speed + layerPhase) * 0.3;
          curtainH += Math.sin(t * Math.PI * 5.0 + now * speed * 0.7 + layerPhase * 2) * 0.15;
          curtainH += Math.sin(t * Math.PI * 1.2 + now * speed * 0.3 + layerPhase * 0.5) * 0.4;
          curtainH += Math.sin(t * Math.PI * 8.0 + now * speed * 1.5 + layerPhase * 3) * 0.08;

          curtainH = (curtainH + 0.93) / 1.86;
          curtainH = Math.max(0, Math.min(1, curtainH));

          let audioMod = 0;
          if (samples.length > 0) {
            const si = Math.floor(t * (samples.length - 1));
            audioMod = Math.abs(samples[si] ?? 0) * 3;
          }

          const baseH = 0.25 + energy * 4;
          const target = Math.min(1, curtainH * (baseH + audioMod * 0.5) * waveScale);
          layer[i] = lerp(layer[i]!, target, TEMPORAL_LERP + energy * 0.1);
        }
      }
    };

    generateCurtain(curtains.send, se.send, wf?.send ?? [], 0);
    generateCurtain(curtains.recv, se.recv, wf?.recv ?? [], 3.7);

    // Build a smooth bezier path from height data
    const buildCurtainPath = (layer: Float64Array, maxH: number, fromTop: boolean) => {
      const step = w / (POINTS - 1);
      g.beginPath();

      // Start at the midline
      g.moveTo(0, midY);

      // Trace the curtain edge with smooth bezier curves
      for (let i = 0; i < POINTS; i++) {
        const x = i * step;
        const extent = layer[i]! * maxH;
        const y = fromTop ? midY - extent : midY + extent;

        if (i === 0) {
          g.lineTo(x, y);
        } else {
          const prevX = (i - 1) * step;
          const prevExtent = layer[i - 1]! * maxH;
          const prevY = fromTop ? midY - prevExtent : midY + prevExtent;
          const cpx = (prevX + x) / 2;
          g.bezierCurveTo(cpx, prevY, cpx, y, x, y);
        }
      }

      // Close back along the midline
      g.lineTo(w, midY);
      g.closePath();
    };

    // Draw curtains
    const drawCurtain = (
      layers: Float64Array[],
      energy: number,
      baseRgb: readonly [number, number, number],
      accentRgb: readonly [number, number, number],
      fromTop: boolean,
    ) => {
      const maxExtent = h * 0.48;

      for (let L = CURTAIN_LAYERS - 1; L >= 0; L--) {
        const layer = layers[L]!;
        const layerDepth = L / CURTAIN_LAYERS;
        const layerAlpha = 0.25 + layerDepth * 0.5;
        const edgeColor = lerpRgb(baseRgb, accentRgb, 0.3 + layerDepth * 0.4);
        const deepColor = lerpRgb(accentRgb, baseRgb, 0.5 + layerDepth * 0.3);

        // Determine max curtain extent for this layer's gradient
        let maxLayerH = 0;
        for (let i = 0; i < POINTS; i++) {
          const hh = layer[i]! * maxExtent;
          if (hh > maxLayerH) maxLayerH = hh;
        }
        if (maxLayerH < 1) continue;

        // Single continuous fill with vertical gradient
        const brightA = Math.min(0.65, layerAlpha * (0.35 + energy * 1.8));

        const fillGrad = fromTop
          ? g.createLinearGradient(0, midY, 0, midY - maxLayerH)
          : g.createLinearGradient(0, midY, 0, midY + maxLayerH);

        fillGrad.addColorStop(0, rgba(edgeColor, brightA));
        fillGrad.addColorStop(0.12, rgba(edgeColor, brightA * 0.75));
        fillGrad.addColorStop(0.35, rgba(lerpRgb(edgeColor, deepColor, 0.4), brightA * 0.4));
        fillGrad.addColorStop(0.65, rgba(deepColor, brightA * 0.12));
        fillGrad.addColorStop(1, rgba(deepColor, brightA * 0.03));

        buildCurtainPath(layer, maxExtent, fromTop);
        g.fillStyle = fillGrad;
        g.fill();

        // Bright glowing edge line (front layer only)
        if (L === 0) {
          g.globalCompositeOperation = "lighter";
          const step = w / (POINTS - 1);

          const traceEdge = () => {
            g.beginPath();
            for (let i = 0; i < POINTS; i++) {
              const x = i * step;
              const extent = layer[i]! * maxExtent;
              const y = fromTop ? midY - extent : midY + extent;
              if (i === 0) {
                g.moveTo(x, y);
              } else {
                const prevX = (i - 1) * step;
                const prevExtent = layer[i - 1]! * maxExtent;
                const prevY = fromTop ? midY - prevExtent : midY + prevExtent;
                const cpx = (prevX + x) / 2;
                g.bezierCurveTo(cpx, prevY, cpx, y, x, y);
              }
            }
          };

          // Wide diffuse glow
          traceEdge();
          g.strokeStyle = rgba(edgeColor, Math.min(0.3, 0.08 + energy * 0.8));
          g.lineWidth = 8 * dpr;
          g.stroke();

          // Core bright line
          traceEdge();
          g.strokeStyle = rgba(edgeColor, Math.min(0.6, 0.15 + energy * 1.2));
          g.lineWidth = 2.5 * dpr;
          g.stroke();

          // White-hot inner
          traceEdge();
          g.strokeStyle = rgba([255, 255, 255], Math.min(0.3, 0.05 + energy * 0.5));
          g.lineWidth = 0.8 * dpr;
          g.stroke();

          g.globalCompositeOperation = "source-over";
        }
      }

      // Vertical ray streaks within the curtain
      g.globalCompositeOperation = "lighter";
      const frontLayer = layers[0]!;
      const rayCount = 10;
      for (let r = 0; r < rayCount; r++) {
        const rx = (r / rayCount + Math.sin(now * 0.08 + r * 0.7) * 0.04) * w;
        const ri = Math.min(POINTS - 1, Math.max(0, Math.floor((rx / w) * (POINTS - 1))));
        const rayH = frontLayer[ri]! * maxExtent;
        if (rayH < 4) continue;

        const rayIntensity = 0.5 + Math.sin(rx / w * Math.PI * 8 + now * 0.3) * 0.3;
        const rayBright = rayIntensity * (0.1 + energy * 0.5);
        const edgeColor = lerpRgb(baseRgb, accentRgb, 0.5);

        const rayGrad = fromTop
          ? g.createLinearGradient(0, midY, 0, midY - rayH)
          : g.createLinearGradient(0, midY, 0, midY + rayH);
        rayGrad.addColorStop(0, rgba(edgeColor, rayBright * 0.5));
        rayGrad.addColorStop(0.25, rgba(edgeColor, rayBright * 0.3));
        rayGrad.addColorStop(0.6, rgba(baseRgb, rayBright * 0.08));
        rayGrad.addColorStop(1, rgba(baseRgb, 0));

        g.fillStyle = rayGrad;
        const rayW = (2.5 + Math.sin(now * 0.25 + r) * 1) * dpr;
        if (fromTop) {
          g.fillRect(rx - rayW / 2, midY - rayH, rayW, rayH);
        } else {
          g.fillRect(rx - rayW / 2, midY, rayW, rayH);
        }
      }
      g.globalCompositeOperation = "source-over";

      // Ambient glow behind the curtain
      g.globalCompositeOperation = "lighter";
      const glowY = fromTop ? h * 0.18 : h * 0.82;
      const glowA = 0.03 + Math.min(0.1, energy * 0.4);
      const gr = g.createRadialGradient(w * 0.5, glowY, 0, w * 0.5, glowY, w * 0.55);
      gr.addColorStop(0, rgba(lerpRgb(baseRgb, accentRgb, 0.4), glowA));
      gr.addColorStop(0.5, rgba(baseRgb, glowA * 0.2));
      gr.addColorStop(1, rgba(baseRgb, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "source-over";
    };

    drawCurtain(curtains.send, se.send, YOU_RGB, YOU_ACCENT, true);
    drawCurtain(curtains.recv, se.recv, THEM_RGB, THEM_ACCENT, false);

    // Subtle center divider
    g.strokeStyle = "rgba(255,255,255,0.02)";
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
      <canvas ref={canvasRef} className="block w-full h-full" style={{ width: "100%", height: "100%" }} aria-label="Frequency aurora" />
    </div>
  );
}
