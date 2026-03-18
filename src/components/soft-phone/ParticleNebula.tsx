/**
 * ParticleNebula — minimal constellation voice visualization.
 *
 * Two networks of glowing orbs (emerald = you on left, blue = them on right)
 * connected by luminous lines. Audio energy pulses the nodes and brightens
 * the connections. Colors shift toward accent hues (cyan/violet) at high
 * energy. Temporal smoothing on all values for fluid animation.
 */

import { useRef, useLayoutEffect, useCallback } from "react";
import { YOU_RGB, THEM_RGB, YOU_ACCENT, THEM_ACCENT, lerp, lerpRgb, rgba } from "./visualizers/viz-shared";

const NODE_COUNT = 32;
const CONNECTION_DIST = 180;
const CROSS_CONNECTION_DIST = 130;

const NODE_MIN_R = 2.5;
const NODE_MAX_R = 6;
const ENERGY_MULT = 10;
const DRIFT = 0.1;
const DAMPING = 0.97;
const HOME_GRAVITY = 0.003;
const TEMPORAL_LERP = 0.12;
const TARGET_FPS = 45;

interface Node {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  r: number;
  energy: number;
  smoothEnergy: number;
  phase: number;
}

function createNode(cx: number, cy: number, spreadX: number, spreadY: number): Node {
  const hx = cx + (Math.random() - 0.5) * spreadX;
  const hy = cy + (Math.random() - 0.5) * spreadY;
  return {
    x: hx, y: hy,
    homeX: hx, homeY: hy,
    vx: 0, vy: 0,
    r: NODE_MIN_R + Math.random() * (NODE_MAX_R - NODE_MIN_R),
    energy: 0.15 + Math.random() * 0.15,
    smoothEnergy: 0.15,
    phase: Math.random() * Math.PI * 2,
  };
}

function rms(samples: number[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  const step = Math.max(1, Math.floor(samples.length / 60));
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    const s = samples[i]!;
    sum += s * s;
    count++;
  }
  return Math.sqrt(sum / count);
}

interface ParticleNebulaProps {
  waveformRef: React.RefObject<{ send: number[]; recv: number[] }>;
  className?: string;
  style?: React.CSSProperties;
}

export function ParticleNebula({ waveformRef, className, style }: ParticleNebulaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<{ you: Node[]; them: Node[] } | null>(null);
  const smoothEnergyRef = useRef({ send: 0, recv: 0 });

  const initNodes = useCallback((w: number, h: number) => {
    const you: Node[] = [];
    const them: Node[] = [];
    const margin = 25;
    for (let i = 0; i < NODE_COUNT; i++) {
      you.push(createNode(w * 0.25, h * 0.5, w * 0.38, h * 0.9));
      them.push(createNode(w * 0.75, h * 0.5, w * 0.38, h * 0.9));
    }
    for (const n of [...you, ...them]) {
      n.homeX = Math.max(margin, Math.min(w - margin, n.homeX));
      n.homeY = Math.max(margin, Math.min(h - margin, n.homeY));
      n.x = n.homeX;
      n.y = n.homeY;
    }
    nodesRef.current = { you, them };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let rafId: number;
    let prevTime = performance.now();
    let lastFrameTime = 0;
    const frameMs = 1000 / TARGET_FPS;

    const draw = (now: number) => {
      if (!canvas || !container) { rafId = requestAnimationFrame(draw); return; }
      if (now - lastFrameTime < frameMs) {
        rafId = requestAnimationFrame(draw);
        return;
      }
      lastFrameTime = now;
      const dt = Math.min((now - prevTime) / 16.67, 3);
      prevTime = now;

      const rect = container.getBoundingClientRect();
      const cw = Math.max(200, Math.floor(rect.width * dpr));
      const ch = Math.max(100, Math.floor(rect.height * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
        initNodes(cw, ch);
      }
      const w = cw;
      const h = ch;
      const g = canvas.getContext("2d");
      if (!g) { rafId = requestAnimationFrame(draw); return; }
      g.lineCap = "round";
      g.lineJoin = "round";
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";

      if (!nodesRef.current) initNodes(w, h);
      const nodes = nodesRef.current!;

      const wf = waveformRef.current;
      const rawSendE = wf ? rms(wf.send) : 0;
      const rawRecvE = wf ? rms(wf.recv) : 0;

      const se = smoothEnergyRef.current;
      se.send = lerp(se.send, rawSendE, TEMPORAL_LERP);
      se.recv = lerp(se.recv, rawRecvE, TEMPORAL_LERP);
      const sendE = se.send;
      const recvE = se.recv;

      const sendColor = lerpRgb(YOU_RGB, YOU_ACCENT, Math.min(1, sendE * 3));
      const recvColor = lerpRgb(THEM_RGB, THEM_ACCENT, Math.min(1, recvE * 3));

      g.clearRect(0, 0, w, h);

      // Ambient glow with accent color shifts
      {
        const sendA = 0.05 + Math.min(0.18, sendE * 0.6);
        const gr = g.createRadialGradient(w * 0.25, h * 0.5, 0, w * 0.25, h * 0.5, w * 0.42);
        gr.addColorStop(0, rgba(sendColor, sendA));
        gr.addColorStop(0.4, rgba(YOU_RGB, sendA * 0.3));
        gr.addColorStop(1, rgba(YOU_RGB, 0));
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }
      {
        const recvA = 0.05 + Math.min(0.18, recvE * 0.6);
        const gr = g.createRadialGradient(w * 0.75, h * 0.5, 0, w * 0.75, h * 0.5, w * 0.42);
        gr.addColorStop(0, rgba(recvColor, recvA));
        gr.addColorStop(0.4, rgba(THEM_RGB, recvA * 0.3));
        gr.addColorStop(1, rgba(THEM_RGB, 0));
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }

      // Update nodes with smooth energy
      const updateNodes = (swarm: Node[], energy: number) => {
        const pulse = energy * ENERGY_MULT;
        for (const n of swarm) {
          n.vx += (Math.random() - 0.5) * DRIFT * dt;
          n.vy += (Math.random() - 0.5) * DRIFT * dt;

          if (energy > 0.01) {
            const angle = n.phase + Math.random() * 0.5;
            n.vx += Math.cos(angle) * pulse * 0.18 * dt;
            n.vy += Math.sin(angle) * pulse * 0.18 * dt;
          }

          const dx = n.homeX - n.x;
          const dy = n.homeY - n.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          const grav = HOME_GRAVITY * dist * dt;
          n.vx += (dx / dist) * grav;
          n.vy += (dy / dist) * grav;

          const d = Math.pow(DAMPING, dt);
          n.vx *= d;
          n.vy *= d;
          n.x += n.vx * dt;
          n.y += n.vy * dt;
          n.x = Math.max(5, Math.min(w - 5, n.x));
          n.y = Math.max(5, Math.min(h - 5, n.y));

          n.energy = 0.2 + energy * 4;
          n.smoothEnergy = lerp(n.smoothEnergy, n.energy, TEMPORAL_LERP);
          n.phase += 0.018 * dt;
        }
      };

      updateNodes(nodes.you, sendE);
      updateNodes(nodes.them, recvE);

      // Draw connections with gradient-aware colors
      const drawConnections = (
        swarm: Node[],
        base: readonly [number, number, number],
        color: [number, number, number],
        maxDist: number,
        baseAlpha: number,
      ) => {
        for (let i = 0; i < swarm.length; i++) {
          for (let j = i + 1; j < swarm.length; j++) {
            const a = swarm[i]!;
            const b = swarm[j]!;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > maxDist) continue;

            const proximity = 1 - dist / maxDist;
            const energy = (a.smoothEnergy + b.smoothEnergy) / 2;
            const alpha = proximity * proximity * energy * baseAlpha;
            if (alpha < 0.003) continue;

            const lineColor = lerpRgb(base, color, energy);
            g.strokeStyle = rgba(lineColor, alpha);
            g.lineWidth = Math.max(0.5, proximity * 2.2 * dpr);
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.stroke();
          }
        }
      };

      drawConnections(nodes.you, YOU_RGB, sendColor, CONNECTION_DIST * dpr, 0.8);
      drawConnections(nodes.them, THEM_RGB, recvColor, CONNECTION_DIST * dpr, 0.8);

      // Cross-channel connections
      const crossDist = CROSS_CONNECTION_DIST * dpr;
      const crossRgb = lerpRgb(sendColor, recvColor, 0.5);
      for (const a of nodes.you) {
        for (const b of nodes.them) {
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > crossDist) continue;
          const proximity = 1 - dist / crossDist;
          const energy = (a.smoothEnergy + b.smoothEnergy) / 2;
          const alpha = proximity * proximity * energy * 0.2;
          if (alpha < 0.003) continue;
          g.strokeStyle = rgba(crossRgb, alpha);
          g.lineWidth = Math.max(0.3, proximity * 1.2 * dpr);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
      }

      // Draw nodes with multi-stop accent gradients
      g.globalCompositeOperation = "lighter";

      const drawNodes = (
        swarm: Node[],
        base: readonly [number, number, number],
        accent: [number, number, number],
      ) => {
        for (const n of swarm) {
          const e = n.smoothEnergy;
          const pulseR = n.r * (0.85 + 0.15 * Math.sin(n.phase)) * dpr;
          const glowR = pulseR * (3.5 + e * 5);
          const nodeColor = lerpRgb(base, accent, e * 0.7);

          // Outer glow with accent shift
          const grad = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR);
          grad.addColorStop(0, rgba(accent, e * 0.6));
          grad.addColorStop(0.15, rgba(nodeColor, e * 0.35));
          grad.addColorStop(0.4, rgba(base, e * 0.12));
          grad.addColorStop(1, rgba(base, 0));
          g.fillStyle = grad;
          g.beginPath();
          g.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          g.fill();

          // Bright colored ring
          const coreAlpha = Math.min(1, 0.5 + e * 1.5);
          g.fillStyle = rgba(nodeColor, coreAlpha);
          g.beginPath();
          g.arc(n.x, n.y, pulseR, 0, Math.PI * 2);
          g.fill();

          // White-hot core
          g.fillStyle = rgba([255, 255, 255], coreAlpha * 0.8);
          g.beginPath();
          g.arc(n.x, n.y, pulseR * 0.4, 0, Math.PI * 2);
          g.fill();
        }
      };

      const sendAccent = lerpRgb(YOU_RGB, YOU_ACCENT, 0.5);
      const recvAccent = lerpRgb(THEM_RGB, THEM_ACCENT, 0.5);

      drawNodes(nodes.you, YOU_RGB, sendAccent);
      drawNodes(nodes.them, THEM_RGB, recvAccent);

      g.globalCompositeOperation = "source-over";

      // Subtle center divider
      g.strokeStyle = "rgba(255,255,255,0.05)";
      g.lineWidth = 1 * dpr;
      g.setLineDash([4 * dpr, 10 * dpr]);
      g.beginPath();
      g.moveTo(w / 2, h * 0.08);
      g.lineTo(w / 2, h * 0.92);
      g.stroke();
      g.setLineDash([]);

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [initNodes, waveformRef]);

  return (
    <div ref={containerRef} className={className} style={style}>
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        style={{ width: "100%", height: "100%" }}
        aria-label="Voice constellation"
      />
    </div>
  );
}
