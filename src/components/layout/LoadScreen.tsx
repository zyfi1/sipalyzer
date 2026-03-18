import { useEffect, useRef, useState } from "react";

export const MIN_LOAD_DISPLAY_MS = 1400;

export interface LoadScreenProps {
  loadedCount?: number;
  totalCount?: number;
}

/* ─── Bar pop-in timing (id suffix, delay) ─── */
const BARS: [string, number][] = [
  ["b1", 0.08],
  ["b2", 0.18],
  ["b3", 0.28],
  ["b4", 0.38],
  ["b5", 0.48],
  ["b6", 0.58],
  ["b7", 0.68],
];

function AnimatedLogo({ className }: { className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    BARS.forEach(([id, del]) => {
      const el = svg.querySelector(`#ls-${id}`) as SVGElement | null;
      if (!el) return;
      el.style.setProperty("--del", `${del}s`);
    });
  }, []);

  return (
    <svg ref={ref} viewBox="0 0 200 200" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="ls-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b" />
          <feComposite in="SourceGraphic" in2="b" operator="over" />
        </filter>
      </defs>
      <g filter="url(#ls-glow)">
        {/* Gradient Solo "S" bars — Pink → Purple (matches app icon) */}
        <rect id="ls-b1" className="ls-bar-pop" x="42"  y="14"  width="120" height="17" rx="8" fill="hsl(330 85% 72%)" />
        <rect id="ls-b2" className="ls-bar-pop" x="22"  y="40"  width="82"  height="17" rx="8" fill="hsl(320 82% 68%)" />
        <rect id="ls-b3" className="ls-bar-pop" x="18"  y="66"  width="58"  height="17" rx="8" fill="hsl(308 80% 66%)" />
        <rect id="ls-b4" className="ls-bar-pop" x="46"  y="92"  width="108" height="17" rx="8" fill="hsl(295 78% 64%)" />
        <rect id="ls-b5" className="ls-bar-pop" x="124" y="118" width="58"  height="17" rx="8" fill="hsl(282 78% 64%)" />
        <rect id="ls-b6" className="ls-bar-pop" x="96"  y="144" width="84"  height="17" rx="8" fill="hsl(270 80% 66%)" />
        <rect id="ls-b7" className="ls-bar-pop" x="38"  y="170" width="122" height="17" rx="8" fill="hsl(258 82% 68%)" />
      </g>
    </svg>
  );
}

/**
 * Full-viewport loading screen — centered animated logo with
 * smooth gradient mesh backdrop, dot grid, and minimal progress indicator.
 */
export function LoadScreen({ loadedCount = 0, totalCount = 6 }: LoadScreenProps) {
  const realProgress = totalCount > 0 ? (loadedCount / totalCount) * 100 : 0;
  const [displayedProgress, setDisplayedProgress] = useState(0);

  // Smooth visual progress toward real preload progress.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setDisplayedProgress((prev) => {
        if (realProgress >= 100) return 100;
        if (realProgress <= prev) return prev;
        const delta = realProgress - prev;
        const step = Math.max(0.4, Math.min(6, delta * 0.25));
        return Math.min(realProgress, prev + step);
      });
    }, 16);

    return () => window.clearInterval(intervalId);
  }, [realProgress]);

  const shownProgress = Math.round(displayedProgress);

  return (
    <div className="ls">
      {/* Animated gradient mesh — smooth conic rotation */}
      <div className="ls__mesh" aria-hidden />

      {/* Secondary radial wash for depth */}
      <div className="ls__wash" aria-hidden />

      {/* Subtle dot grid overlay */}
      <div className="ls__grid" aria-hidden />

      {/* Radial pulse ring behind logo */}
      <div className="ls__pulse" aria-hidden />

      {/* Noise texture */}
      <div className="ls__noise" aria-hidden />

      {/* Center stack */}
      <div className="ls__center">
        {/* Animated logo */}
        <div className="ls__logo ls--vis">
          <AnimatedLogo className="ls__logo-svg" />
        </div>

        {/* Title — fades in after logo finishes drawing */}
        <div className="ls__text ls--vis">
          <h1 className="ls__title">SIPalyzer</h1>
          <p className="ls__sub">Packets don't lie</p>
        </div>

        {/* Minimal progress bar */}
        <div className="ls__progress ls--vis">
          <div className="ls__bar">
            <div className="ls__fill" style={{ width: `${displayedProgress}%` }}
              role="progressbar" aria-valuenow={loadedCount}
              aria-valuemin={0} aria-valuemax={totalCount} />
          </div>
          <span className="ls__pct">{shownProgress}%</span>
        </div>
      </div>
    </div>
  );
}
