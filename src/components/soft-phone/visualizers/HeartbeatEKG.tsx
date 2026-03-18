/**
 * HeartbeatEKG — luminous pulse-monitor traces.
 *
 * Two horizontal traces scroll right-to-left. Emerald (you) on top,
 * blue (them) on bottom. Smooth bezier curves replace jagged lineTo
 * segments. Colors shift toward accent hues at high energy. Temporal
 * lerp smooths all values for fluid animation.
 */

import { useRef, useLayoutEffect, useCallback } from "react";
import {
  YOU_RGB, THEM_RGB, YOU_ACCENT, THEM_ACCENT,
  rms, lerp, lerpRgb, rgba, setupCanvas,
  type VisualizerProps,
} from "./viz-shared";

const HISTORY_LEN = 300;
const SCROLL_SPEED = 2;
const TEMPORAL_LERP = 0.18;
const TARGET_FPS = 45;

export function HeartbeatEKG({ waveformRef, className, style }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const histRef = useRef<{ send: number[]; recv: number[] } | null>(null);
  const headRef = useRef(0);
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

    if (!histRef.current) {
      histRef.current = {
        send: new Array(HISTORY_LEN).fill(0),
        recv: new Array(HISTORY_LEN).fill(0),
      };
    }
    const hist = histRef.current;

    const w = cw;
    const h = ch;
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

    // Push new samples
    for (let s = 0; s < SCROLL_SPEED; s++) {
      const head = headRef.current % HISTORY_LEN;
      const si = Math.floor((s / SCROLL_SPEED) * Math.max(1, sendSamples.length));
      const ri = Math.floor((s / SCROLL_SPEED) * Math.max(1, recvSamples.length));
      hist.send[head] = sendSamples.length > 0
        ? Math.max(-1, Math.min(1, (sendSamples[si % sendSamples.length] ?? 0) * (0.8 + sendE * 6)))
        : sendE * 0.4;
      hist.recv[head] = recvSamples.length > 0
        ? Math.max(-1, Math.min(1, (recvSamples[ri % recvSamples.length] ?? 0) * (0.8 + recvE * 6)))
        : recvE * 0.4;
      headRef.current++;
    }

    const sendColor = lerpRgb(YOU_RGB, YOU_ACCENT, Math.min(1, sendE * 3));
    const recvColor = lerpRgb(THEM_RGB, THEM_ACCENT, Math.min(1, recvE * 3));

    g.clearRect(0, 0, w, h);

    // Ambient radial glows
    {
      const a = 0.04 + Math.min(0.14, sendE * 0.5);
      const gr = g.createRadialGradient(w * 0.7, h * 0.3, 0, w * 0.7, h * 0.3, w * 0.5);
      gr.addColorStop(0, rgba(sendColor, a));
      gr.addColorStop(0.5, rgba(YOU_RGB, a * 0.25));
      gr.addColorStop(1, rgba(YOU_RGB, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    {
      const a = 0.04 + Math.min(0.14, recvE * 0.5);
      const gr = g.createRadialGradient(w * 0.7, h * 0.7, 0, w * 0.7, h * 0.7, w * 0.5);
      gr.addColorStop(0, rgba(recvColor, a));
      gr.addColorStop(0.5, rgba(THEM_RGB, a * 0.25));
      gr.addColorStop(1, rgba(THEM_RGB, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }

    // Subtle dot grid
    const gridSpacing = 28 * dpr;
    g.fillStyle = "rgba(255,255,255,0.02)";
    for (let x = gridSpacing; x < w; x += gridSpacing) {
      for (let y = gridSpacing; y < h; y += gridSpacing) {
        g.beginPath();
        g.arc(x, y, 0.6 * dpr, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Draw traces with smooth bezier curves
    const drawTrace = (
      data: number[],
      base: readonly [number, number, number],
      color: [number, number, number],
      accent: [number, number, number],
      energy: number,
      centerY: number,
      maxAmp: number,
    ) => {
      const head = headRef.current % HISTORY_LEN;
      const step = w / HISTORY_LEN;

      const pathCoords: { x: number; y: number }[] = [];
      for (let i = 0; i < HISTORY_LEN; i++) {
        const idx = (head + 1 + i) % HISTORY_LEN;
        pathCoords.push({ x: i * step, y: centerY - data[idx]! * maxAmp });
      }

      // Smooth bezier path builder
      const drawSmoothPath = () => {
        g.beginPath();
        if (pathCoords.length < 2) return;
        g.moveTo(pathCoords[0]!.x, pathCoords[0]!.y);
        for (let i = 1; i < pathCoords.length; i++) {
          const prev = pathCoords[i - 1]!;
          const curr = pathCoords[i]!;
          const cpx = (prev.x + curr.x) / 2;
          g.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
        }
      };

      g.globalCompositeOperation = "lighter";

      // Wide diffuse glow
      drawSmoothPath();
      g.strokeStyle = rgba(base, Math.min(0.15, 0.03 + energy * 0.7));
      g.lineWidth = 12 * dpr;
      g.stroke();

      // Medium accent glow
      drawSmoothPath();
      g.strokeStyle = rgba(accent, Math.min(0.2, 0.04 + energy * 0.9));
      g.lineWidth = 5 * dpr;
      g.stroke();

      // Core line
      drawSmoothPath();
      const coreA = Math.min(0.85, 0.18 + energy * 3);
      g.strokeStyle = rgba(color, coreA);
      g.lineWidth = 1.8 * dpr;
      g.stroke();

      // White-hot inner
      drawSmoothPath();
      g.strokeStyle = rgba([255, 255, 255], coreA * 0.35);
      g.lineWidth = 0.6 * dpr;
      g.stroke();

      // Phosphor fade
      g.globalCompositeOperation = "source-over";
      const fadeGrad = g.createLinearGradient(0, 0, w, 0);
      fadeGrad.addColorStop(0, "rgba(10,15,30,0.55)");
      fadeGrad.addColorStop(0.6, "rgba(10,15,30,0.1)");
      fadeGrad.addColorStop(1, "rgba(10,15,30,0)");
      g.fillStyle = fadeGrad;
      g.fillRect(0, centerY - maxAmp - 14 * dpr, w, maxAmp * 2 + 28 * dpr);

      // Leading dot with multi-layer glow
      g.globalCompositeOperation = "lighter";
      const lastPt = pathCoords[pathCoords.length - 1]!;

      // Outer glow orb with gradient
      const orbGrad = g.createRadialGradient(lastPt.x, lastPt.y, 0, lastPt.x, lastPt.y, 20 * dpr);
      orbGrad.addColorStop(0, rgba(accent, 0.5 + energy));
      orbGrad.addColorStop(0.2, rgba(color, 0.25 + energy * 0.4));
      orbGrad.addColorStop(0.5, rgba(base, 0.08));
      orbGrad.addColorStop(1, rgba(base, 0));
      g.fillStyle = orbGrad;
      g.beginPath();
      g.arc(lastPt.x, lastPt.y, 20 * dpr, 0, Math.PI * 2);
      g.fill();

      // Bright core
      g.fillStyle = rgba(color, 0.9);
      g.beginPath();
      g.arc(lastPt.x, lastPt.y, 2.8 * dpr, 0, Math.PI * 2);
      g.fill();

      // White-hot center
      g.fillStyle = rgba([255, 255, 255], 0.9);
      g.beginPath();
      g.arc(lastPt.x, lastPt.y, 1.3 * dpr, 0, Math.PI * 2);
      g.fill();

      g.globalCompositeOperation = "source-over";
    };

    const sendAccent = lerpRgb(YOU_RGB, YOU_ACCENT, 0.5);
    const recvAccent = lerpRgb(THEM_RGB, THEM_ACCENT, 0.5);

    drawTrace(hist.send, YOU_RGB, sendColor, sendAccent, sendE, h * 0.27, h * 0.24);
    drawTrace(hist.recv, THEM_RGB, recvColor, recvAccent, recvE, h * 0.73, h * 0.24);

    // Center divider
    g.strokeStyle = "rgba(255,255,255,0.035)";
    g.lineWidth = 1 * dpr;
    g.setLineDash([4 * dpr, 10 * dpr]);
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
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
      <canvas ref={canvasRef} className="block w-full h-full" style={{ width: "100%", height: "100%" }} aria-label="Heartbeat EKG" />
    </div>
  );
}
