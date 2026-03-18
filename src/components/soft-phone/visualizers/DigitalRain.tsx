/**
 * DigitalRain — luminous Matrix-style falling columns.
 *
 * Columns of falling glyphs react to audio energy. Emerald rains from
 * the top (you), blue rises from the bottom (them). Each character has
 * multi-layer glow with accent color shifts. Smoother brightness
 * transitions via lerp. Anti-aliased text rendering.
 */

import { useRef, useLayoutEffect, useCallback } from "react";
import {
  YOU_RGB, THEM_RGB, YOU_ACCENT, THEM_ACCENT,
  rms, lerp, lerpRgb, rgba, setupCanvas,
  type VisualizerProps,
} from "./viz-shared";

const CHARS = "01アイウエオカキクケコサシスセソ";
const COL_SPACING = 20;
const CHAR_SIZE = 12;
const FADE_SPEED = 0.018;
const TEMPORAL_LERP = 0.14;
const TARGET_FPS = 42;

interface RainColumn {
  x: number;
  head: number;
  speed: number;
  chars: string[];
  brightness: number[];
  smoothBrightness: number[];
}

export function DigitalRain({ waveformRef, className, style }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<{ send: RainColumn[]; recv: RainColumn[] } | null>(null);
  const initRef = useRef(false);
  const smoothEnergyRef = useRef({ send: 0, recv: 0 });

  const initColumns = useCallback((w: number, h: number, dpr: number) => {
    const numCols = Math.floor(w / (COL_SPACING * dpr));
    const maxChars = Math.floor(h / (CHAR_SIZE * dpr)) + 2;

    const makeColumns = (): RainColumn[] =>
      Array.from({ length: numCols }, (_, i) => ({
        x: i * COL_SPACING * dpr + (COL_SPACING * dpr) / 2,
        head: Math.random() * maxChars,
        speed: 0.3 + Math.random() * 0.5,
        chars: Array.from({ length: maxChars }, () =>
          CHARS[Math.floor(Math.random() * CHARS.length)]!,
        ),
        brightness: new Array(maxChars).fill(0),
        smoothBrightness: new Array(maxChars).fill(0),
      }));

    columnsRef.current = { send: makeColumns(), recv: makeColumns() };
    initRef.current = true;
  }, []);

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
      initRef.current = false;
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    setupCanvas(g);

    if (!initRef.current) initColumns(cw, ch, dpr);
    if (!columnsRef.current) return;

    const w = cw;
    const h = ch;
    const midY = h / 2;
    const wf = waveformRef.current;
    const rawSendE = rms(wf?.send ?? []);
    const rawRecvE = rms(wf?.recv ?? []);
    const charH = CHAR_SIZE * dpr;

    const se = smoothEnergyRef.current;
    se.send = lerp(se.send, rawSendE, TEMPORAL_LERP);
    se.recv = lerp(se.recv, rawRecvE, TEMPORAL_LERP);
    const sendE = se.send;
    const recvE = se.recv;

    const sendColor = lerpRgb(YOU_RGB, YOU_ACCENT, Math.min(1, sendE * 3));
    const recvColor = lerpRgb(THEM_RGB, THEM_ACCENT, Math.min(1, recvE * 3));

    // Fade previous frame
    g.fillStyle = "rgba(10,15,30,0.17)";
    g.fillRect(0, 0, w, h);

    // Ambient radial glows
    {
      const a = 0.014 + Math.min(0.045, sendE * 0.2);
      const gr = g.createRadialGradient(w * 0.3, h * 0.25, 0, w * 0.3, h * 0.25, w * 0.55);
      gr.addColorStop(0, rgba(sendColor, a));
      gr.addColorStop(0.5, rgba(YOU_RGB, a * 0.25));
      gr.addColorStop(1, rgba(YOU_RGB, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    {
      const a = 0.014 + Math.min(0.045, recvE * 0.2);
      const gr = g.createRadialGradient(w * 0.7, h * 0.75, 0, w * 0.7, h * 0.75, w * 0.55);
      gr.addColorStop(0, rgba(recvColor, a));
      gr.addColorStop(0.5, rgba(THEM_RGB, a * 0.25));
      gr.addColorStop(1, rgba(THEM_RGB, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }

    const updateAndDraw = (
      cols: RainColumn[],
      energy: number,
      base: readonly [number, number, number],
      color: [number, number, number],
      accent: [number, number, number],
      fromTop: boolean,
    ) => {
      const speedMul = 0.3 + energy * 4.1;
      const maxChars = Math.floor(h / charH) + 2;

      g.font = `${Math.round(CHAR_SIZE * dpr * 0.85)}px monospace`;
      g.textAlign = "center";
      g.textBaseline = "middle";

      for (const col of cols) {
        // Spatial contour mask creates visible peaks/valleys across columns.
        const contour =
          0.45 +
          0.55 *
            ((Math.sin((col.x / Math.max(1, w)) * Math.PI * 3 + performance.now() * 0.00075) + 1) * 0.5);

        col.head += col.speed * speedMul * (0.72 + contour * 0.5);
        if (col.head >= maxChars * 2) col.head = 0;

        const headIdx = Math.floor(col.head);

        for (let i = 0; i < col.brightness.length && i < maxChars; i++) {
          if (i === headIdx % maxChars) {
            col.brightness[i] = Math.min(1, (0.42 + energy * 1.45) * contour);
            if (Math.random() < 0.12) {
              col.chars[i] = CHARS[Math.floor(Math.random() * CHARS.length)]!;
            }
          } else {
            col.brightness[i] = Math.max(0, col.brightness[i]! - (FADE_SPEED + (1 - contour) * 0.01));
          }
          col.smoothBrightness[i] = lerp(
            col.smoothBrightness[i]!, col.brightness[i]!, 0.2,
          );
        }

        for (let i = 0; i < Math.min(col.smoothBrightness.length, maxChars); i++) {
          const b = col.smoothBrightness[i]!;
          if (b < 0.01) continue;

          const y = fromTop
            ? i * charH + charH / 2
            : h - i * charH - charH / 2;

          const overlap = charH * 1.5;
          if (fromTop && y > midY + overlap) continue;
          if (!fromTop && y < midY - overlap) continue;

          const isHead = i === headIdx % maxChars;
          const charColor = lerpRgb(base, accent, b * 0.6);

          // Keep more breathing room between trail glyphs.
          if (!isHead && i % 2 === 1) continue;

          if (isHead) {
            // Head character: multi-layer glow
            g.globalCompositeOperation = "lighter";
            const orbGrad = g.createRadialGradient(col.x, y, 0, col.x, y, charH * 1.35);
            orbGrad.addColorStop(0, rgba(accent, b * 0.35));
            orbGrad.addColorStop(0.3, rgba(color, b * 0.14));
            orbGrad.addColorStop(0.6, rgba(base, b * 0.04));
            orbGrad.addColorStop(1, rgba(base, 0));
            g.fillStyle = orbGrad;
            g.beginPath();
            g.arc(col.x, y, charH * 1.35, 0, Math.PI * 2);
            g.fill();

            // White-hot character
            g.fillStyle = rgba([255, 255, 255], b * 0.78);
            g.fillText(col.chars[i % col.chars.length]!, col.x, y);
            g.globalCompositeOperation = "source-over";
          } else {
            // Trail characters
            g.globalCompositeOperation = "lighter";

            if (b > 0.18) {
              const charGlow = g.createRadialGradient(col.x, y, 0, col.x, y, charH * 0.62);
              charGlow.addColorStop(0, rgba(charColor, b * 0.11));
              charGlow.addColorStop(0.6, rgba(base, b * 0.025));
              charGlow.addColorStop(1, rgba(base, 0));
              g.fillStyle = charGlow;
              g.beginPath();
              g.arc(col.x, y, charH * 0.62, 0, Math.PI * 2);
              g.fill();
            }

            g.fillStyle = rgba(charColor, b * 0.62);
            g.fillText(col.chars[i % col.chars.length]!, col.x, y);
            g.globalCompositeOperation = "source-over";
          }
        }
      }
    };

    const sendAccent = lerpRgb(YOU_RGB, YOU_ACCENT, 0.5);
    const recvAccent = lerpRgb(THEM_RGB, THEM_ACCENT, 0.5);

    updateAndDraw(columnsRef.current.send, sendE, YOU_RGB, sendColor, sendAccent, true);
    updateAndDraw(columnsRef.current.recv, recvE, THEM_RGB, recvColor, recvAccent, false);

    // Center divider glow
    g.globalCompositeOperation = "lighter";
    const divGrad = g.createLinearGradient(0, midY - 6 * dpr, 0, midY + 6 * dpr);
    divGrad.addColorStop(0, "rgba(255,255,255,0)");
    divGrad.addColorStop(0.5, "rgba(255,255,255,0.018)");
    divGrad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = divGrad;
    g.fillRect(0, midY - 6 * dpr, w, 12 * dpr);
    g.globalCompositeOperation = "source-over";
  }, [waveformRef, initColumns]);

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
      <canvas ref={canvasRef} className="block w-full h-full" style={{ width: "100%", height: "100%" }} aria-label="Digital rain" />
    </div>
  );
}
