/**
 * DeviceView — Accurate 2D SVG representation of Yealink phone front panels.
 * 
 * Renders physical layout based on model specifications:
 * - Screen with status/time/date
 * - Physical line keys with LEDs in correct positions (left, right, or both sides)
 * - Softkeys below screen
 * - Each button shows its provisioned configuration
 * 
 * No 3D, no gimmicks — accurate visual representation of config → physical device.
 */

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { getDeviceLayout, modelSupportsSidecar } from "./deviceLayouts";
import { useDeviceViewData, useSidecarData, type KeyValue, type LineKeyConfig, type LedStatus, type SidecarUnit, type SoftkeyMeta } from "./deviceViewData";
import { SidecarMockup } from "./SidecarMockup";
import { cn } from "@/lib/utils";
import { fetchImageBase64 } from "@/api/provision";


// ============================================================================
// WALLPAPER LOADER — fetches image URL and converts to data URL for SVG use
// ============================================================================

function useWallpaperDataUrl(url: string | null): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setDataUrl(null);
      return;
    }

    let cancelled = false;

    // Fetch image via Tauri backend to bypass CORS restrictions.
    // The backend fetches the image, converts to base64 data URL, and returns it.
    async function load() {
      try {
        const result = await fetchImageBase64(url!);
        if (!cancelled && result) {
          setDataUrl(result);
        }
      } catch (err) {
        console.warn("[Wallpaper] Backend fetch failed for", url, err);
        // Fallback: use raw URL directly — SVG <image> may still render it
        if (!cancelled) setDataUrl(url!);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [url]);

  return dataUrl;
}

// ============================================================================
// SVG DIMENSIONS AND COLORS
// ============================================================================

const COLORS = {
  chassis: "#1a1d21",
  chassisHighlight: "#2a2d32",
  screen: "#1e3a2f",
  screenBorder: "#0a0c0e",
  screenText: "#b8e0c8",
  screenTextDim: "#5a8068",
  button: "#2a2d32",
  buttonBorder: "#3a3d42",
  buttonText: "#d0d0d0",
  buttonTextDim: "#808080",
  softkey: "#1f2226",
  softkeyBorder: "#3a3d42",
  softkeyText: "#a0a0a0",
  ledOff: "#2a2a2a",
  ledGreen: "#22c55e",
  ledRed: "#ef4444",
  ledAmber: "#f59e0b",
};

// ============================================================================
// LED COMPONENT
// ============================================================================

function Led({ status, size = 6 }: { status: LedStatus; size?: number }) {
  const color = {
    off: COLORS.ledOff,
    green: COLORS.ledGreen,
    red: COLORS.ledRed,
    amber: COLORS.ledAmber,
    blinking: COLORS.ledGreen,
  }[status];
  
  return (
    <circle
      r={size / 2}
      fill={color}
      style={{
        filter: status !== "off" ? `drop-shadow(0 0 3px ${color})` : undefined,
        animation: status === "blinking" ? "blink var(--motion-duration-attention) infinite" : undefined,
      }}
    />
  );
}

// ============================================================================
// LINE KEY BUTTON COMPONENT
// ============================================================================

function LineKeyButton({
  config,
  x,
  y,
  width,
  height,
  ledPosition,
}: {
  config: LineKeyConfig;
  x: number;
  y: number;
  width: number;
  height: number;
  ledPosition: "left" | "right";
}) {
  const ledSize = Math.max(3, Math.round(height * 0.22));
  const ledMargin = Math.round(ledSize * 1.6);
  const ledX = ledPosition === "left" ? x + ledMargin : x + width - ledMargin;
  const textX = ledPosition === "left" ? x + ledMargin + ledSize + 4 : x + 4;
  const textWidth = width - ledMargin - ledSize - 8;
  const labelFs = Math.max(5, Math.min(9, height * 0.4));
  const typeFs = Math.max(4, Math.min(7, height * 0.26));
  
  return (
    <g>
      {/* Button background */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        fill={config.isConfigured ? COLORS.button : COLORS.chassis}
        stroke={COLORS.buttonBorder}
        strokeWidth={1}
      />
      
      {/* LED indicator */}
      <g transform={`translate(${ledX}, ${y + height / 2})`}>
        <Led status={config.ledStatus} size={ledSize} />
      </g>
      
      {/* Button label */}
      <text
        x={textX}
        y={y + height / 2}
        dominantBaseline="middle"
        fill={config.isConfigured ? COLORS.buttonText : COLORS.buttonTextDim}
        fontSize={labelFs}
        fontFamily="system-ui, sans-serif"
        style={{ userSelect: "none" }}
      >
        <tspan>{truncateText(config.displayLabel, textWidth, labelFs)}</tspan>
      </text>
      
      {/* Type indicator (small) */}
      {config.isConfigured && config.type !== 15 && height >= 20 && (
        <text
          x={textX}
          y={y + height - Math.max(3, height * 0.12)}
          fill={COLORS.buttonTextDim}
          fontSize={typeFs}
          fontFamily="system-ui, sans-serif"
          style={{ userSelect: "none" }}
        >
          {config.typeShortName}
        </text>
      )}
    </g>
  );
}

// ============================================================================
// SOFTKEY BUTTON COMPONENT (physical button — unlabeled, like real Yealink)
// ============================================================================

function SoftkeyButton({
  x,
  y,
  width,
  height,
  onClick,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  onClick?: () => void;
}) {
  return (
    <g
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        fill={COLORS.softkey}
        stroke={COLORS.softkeyBorder}
        strokeWidth={0.5}
      />
      {/* Small nub/dot to indicate physical button */}
      <circle
        cx={x + width / 2}
        cy={y + height / 2}
        r={Math.max(1, height * 0.08)}
        fill={COLORS.softkeyBorder}
      />
    </g>
  );
}

// ============================================================================
// SCREEN COMPONENT
// ============================================================================

/** Animated dots component — cycles ". → .. → ..." */
function AnimatedDots({ fontSize, fill }: { fontSize: number; fill: string }) {
  const [dotCount, setDotCount] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setDotCount(d => (d % 3) + 1), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <tspan fill={fill} fontSize={fontSize}>{".".repeat(dotCount)}</tspan>
  );
}

/** Format seconds to MM:SS or HH:MM:SS */
function formatCallDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${String(h).padStart(2, "0")}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

function Screen({
  x,
  y,
  width,
  height,
  modelName,
  mac,
  timeStr,
  dateStr,
  accounts,
  networkIp,
  inCall = false,
  callPhase = "idle" as CallPhase,
  callSeconds = 0,
  holdSeconds = 0,
  wallpaperUrl,
  isGrayscale = false,
  dssKeyPanelWidth = 0,
  softkeyLabels = [] as string[],
  onSoftkeyClick,
  pressedSoftkey = null as string | null,
  dialingDigits = "",
  dialTarget = "",
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  modelName: string;
  mac: string | null;
  timeStr: string;
  dateStr: string;
  accounts: { displayLabel: string; isRegistered: boolean }[];
  networkIp: string | null;
  inCall?: boolean;
  callPhase?: CallPhase;
  callSeconds?: number;
  holdSeconds?: number;
  wallpaperUrl?: string | null;
  isGrayscale?: boolean;
  dssKeyPanelWidth?: number;
  softkeyLabels?: string[];
  onSoftkeyClick?: (label: string) => void;
  pressedSoftkey?: string | null;
  dialingDigits?: string;
  dialTarget?: string;
}) {
  // ── Proportional sizing ──
  const s = Math.pow(width / 200, 0.6);
  const pad = Math.round(6 * s);
  const statusBarH = Math.round(14 * s);
  const softkeyBarH = Math.round(12 * s); // on-screen softkey label bar height
  const registeredAccounts = accounts.filter(a => a.isRegistered);
  const primaryAccount = registeredAccounts[0];
  const clipId = `screen-clip-${x}-${y}`;
  // When there's a DSS panel on the right, content is constrained to the left side
  const hasDssPanel = dssKeyPanelWidth > 0 && callPhase === "idle";
  const contentWidth = (hasDssPanel ? width - dssKeyPanelWidth : width) - pad * 2;
  const calleeName = primaryAccount
    ? truncateText(primaryAccount.displayLabel, contentWidth, Math.round(11 * s))
    : "Unknown";

  // Font sizes that scale with screen
  const fs = {
    statusBar: Math.max(5, Math.round(7 * s)),
    statusBarSmall: Math.max(4, Math.round(5.5 * s)),
    time: Math.max(10, Math.round(16 * s)),
    date: Math.max(6, Math.round(8 * s)),
    accountLine: Math.max(5.5, Math.round(7.5 * s)),
    callStatus: Math.max(5, Math.round(6.5 * s)),
    calleeName: Math.max(8, Math.round(11 * s)),
    callTimer: Math.max(10, Math.round(14 * s)),
    callInfo: Math.max(5, Math.round(6.5 * s)),
    ip: Math.max(4, Math.round(5.5 * s)),
    softkeyLabel: Math.max(4, Math.round(5.5 * s)),
  };
  const lineH = Math.round(11 * s);
  const accDotR = Math.max(2, Math.round(2.5 * s));

  // Colors — grayscale screens use monochrome
  const col = {
    bg: isGrayscale ? "#2a3a2a" : COLORS.screen,
    bgCall: isGrayscale ? "#1a2a1a" : "#1a2f1e",
    bgDial: isGrayscale ? "#1a2a2a" : "#1a2a35",
    bgHold: isGrayscale ? "#2a2a1a" : "#2a2510",
    bgTransfer: isGrayscale ? "#1a2a2a" : "#1a2535",
    text: isGrayscale ? "#c0d8c0" : COLORS.screenText,
    textDim: isGrayscale ? "#6a8a6a" : COLORS.screenTextDim,
    green: "#22c55e",
    blue: "#60a5fa",
    amber: "#f59e0b",
    statusBg: "rgba(0,0,0,0.3)",
  };

  // Screen background by phase
  const screenBg = callPhase === "dialing" || callPhase === "xfer_dialing" || callPhase === "conf_dialing" ? col.bgDial
    : callPhase === "ringing" || callPhase === "xfer_ringing" || callPhase === "conf_ringing" ? col.bgCall
    : callPhase === "connected" || callPhase === "conf_connected" ? col.bgCall
    : callPhase === "hold" ? col.bgHold
    : callPhase === "transfer" ? col.bgTransfer
    : callPhase === "conference" ? col.bgCall
    : col.bg;

  // Status bar right text
  const statusRight = callPhase === "dialing" || callPhase === "xfer_dialing" || callPhase === "conf_dialing" ? "DIALING"
    : callPhase === "ringing" || callPhase === "xfer_ringing" || callPhase === "conf_ringing" ? "RINGING"
    : callPhase === "connected" || callPhase === "conf_connected" ? formatCallDuration(callSeconds)
    : callPhase === "hold" ? "HOLD"
    : callPhase === "transfer" ? "TRANSFER"
    : callPhase === "conference" ? formatCallDuration(callSeconds)
    : (mac || "—");

  // Call entry row dimensions (used by compact in-call layouts)
  const rowH = Math.round(16 * s);
  const rowPad = Math.round(4 * s);
  const iconSize = Math.max(5, Math.round(7 * s));
  const rowNameFs = Math.max(5.5, Math.round(7.5 * s));
  const rowInfoFs = Math.max(4, Math.round(5.5 * s));
  const rowTimerFs = Math.max(5, Math.round(6.5 * s));

  const contentY = y + statusBarH + Math.round(6 * s);
  // Main content area stops above the softkey label bar
  const hasSoftkeyBar = softkeyLabels.length > 0;
  const softkeyBarY = y + height - softkeyBarH;

  return (
    <g>
      {/* Clip path */}
      <defs>
        <clipPath id={clipId}>
          <rect x={x} y={y} width={width} height={height} rx={Math.round(3 * s)} />
        </clipPath>
      </defs>

      {/* Screen background */}
      <rect
        x={x} y={y} width={width} height={height}
        rx={Math.round(3 * s)}
        fill={screenBg}
        stroke={COLORS.screenBorder}
        strokeWidth={Math.max(1, Math.round(1.5 * s))}
      />

      {/* Wallpaper (idle only) */}
      {wallpaperUrl && callPhase === "idle" && (
        <image
          href={wallpaperUrl}
          xlinkHref={wallpaperUrl}
          x={x} y={y} width={width} height={height}
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid slice"
          opacity={0.7}
        />
      )}

      {/* ── Status bar ── */}
      <rect x={x} y={y} width={width} height={statusBarH} rx={Math.round(3 * s)} fill={col.statusBg} />
      <rect x={x} y={y + statusBarH - Math.round(3 * s)} width={width} height={Math.round(3 * s)} fill={col.statusBg} />
      <text
        x={x + pad} y={y + statusBarH * 0.72}
        fill={col.text} fontSize={fs.statusBar} fontWeight="600" fontFamily="system-ui, sans-serif"
      >
        {modelName}
      </text>
      <text
        x={x + pad + contentWidth} y={y + statusBarH * 0.72}
        textAnchor="end"
        fill={callPhase === "hold" ? col.amber : inCall ? col.green : col.textDim}
        fontSize={fs.statusBarSmall} fontFamily='"Geist Mono Variable", monospace'
      >
        {statusRight}
      </text>

      {/* ── Main content ── */}
      <g transform={`translate(${x + pad}, ${contentY})`}>

        {/* ════════ IDLE ════════ */}
        {callPhase === "idle" && (
          <>
            <text
              x={isGrayscale ? 0 : contentWidth / 2}
              textAnchor={isGrayscale ? "start" : "middle"}
              fill={col.text} fontSize={fs.time} fontWeight="600" fontFamily="system-ui, sans-serif"
            >
              {timeStr}
            </text>
            <text
              x={isGrayscale ? 0 : contentWidth / 2}
              y={Math.round(18 * s)}
              textAnchor={isGrayscale ? "start" : "middle"}
              fill={col.textDim} fontSize={fs.date} fontFamily="system-ui, sans-serif"
            >
              {dateStr}
            </text>
            <g transform={`translate(0, ${Math.round(36 * s)})`}>
              {registeredAccounts.slice(0, isGrayscale ? 2 : 4).map((acc, i) => (
                <g key={i} transform={`translate(0, ${i * lineH})`}>
                  <circle cx={accDotR} cy={-accDotR} r={accDotR} fill={col.green} />
                  <text
                    x={accDotR * 2 + Math.round(4 * s)}
                    fill={col.text} fontSize={fs.accountLine} fontFamily="system-ui, sans-serif"
                  >
                    {truncateText(acc.displayLabel, contentWidth - accDotR * 3, fs.accountLine)}
                  </text>
                </g>
              ))}
              {registeredAccounts.length === 0 && (
                <text fill={col.textDim} fontSize={fs.accountLine} fontFamily="system-ui, sans-serif">
                  No accounts registered
                </text>
              )}
            </g>
          </>
        )}

        {/* ════════ DIALING (initial outbound call) ════════ */}
        {callPhase === "dialing" && (
          <g>
            {/* Dial input row — shows digits appearing */}
            <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
              rx={Math.round(2 * s)} fill="rgba(192,132,252,0.1)" />
            <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
              rx={Math.round(1 * s)} fill={col.blue} />
            <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.blue} fontSize={iconSize} fontFamily="system-ui, sans-serif">
              ➜
            </text>
            {/* Animated digits or callee name */}
            <text x={rowPad + iconSize + rowPad} y={rowH * 0.38} dominantBaseline="central"
              fill={col.text} fontSize={Math.max(7, Math.round(9.5 * s))} fontWeight="700" fontFamily='"Geist Mono Variable", monospace'
              letterSpacing={Math.round(1.5 * s)}>
              {dialingDigits || ""}
            </text>
            {/* Blinking cursor after digits */}
            {dialingDigits.length < dialTarget.length && (
              <rect x={rowPad + iconSize + rowPad + dialingDigits.length * Math.round(7 * s)} y={rowH * 0.2}
                width={Math.max(1, 1.5 * s)} height={Math.round(7 * s)} fill={col.blue}>
                <animate attributeName="opacity" values="1;0;1" dur="0.8s" repeatCount="indefinite" />
              </rect>
            )}
            <text x={rowPad + iconSize + rowPad} y={rowH * 0.82} dominantBaseline="central"
              fill={col.blue} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              Calling<AnimatedDots fontSize={rowInfoFs} fill={col.blue} />
            </text>
            <text y={rowH + Math.round(8 * s)} fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.green}>●</tspan>{" Line 1"}
            </text>
          </g>
        )}

        {/* ════════ RINGING (initial outbound call) ════════ */}
        {callPhase === "ringing" && (
          <g>
            <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
              rx={Math.round(2 * s)} fill="rgba(34,197,94,0.1)" />
            <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
              rx={Math.round(1 * s)} fill={col.green} />
            <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.green} fontSize={iconSize} fontFamily="system-ui, sans-serif">
              🔔
            </text>
            <text x={rowPad + iconSize + rowPad} y={rowH * 0.38} dominantBaseline="central"
              fill={col.text} fontSize={Math.max(7, Math.round(9.5 * s))} fontWeight="700" fontFamily='"Geist Mono Variable", monospace'
              letterSpacing={Math.round(1.5 * s)}>
              {dialTarget}
            </text>
            <text x={rowPad + iconSize + rowPad} y={rowH * 0.82} dominantBaseline="central"
              fill={col.green} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              Ringing<AnimatedDots fontSize={rowInfoFs} fill={col.green} />
            </text>
            <text y={rowH + Math.round(8 * s)} fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.green}>●</tspan>{" Line 1"}
            </text>
          </g>
        )}

        {/* ════════ CONNECTED (Talking) ════════ */}
        {callPhase === "connected" && (
          <g>
            {/* Call entry row */}
            <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
              rx={Math.round(2 * s)} fill="rgba(34,197,94,0.08)" />
            {/* Left accent */}
            <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
              rx={Math.round(1 * s)} fill={col.green} />
            {/* Handset icon */}
            <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.green} fontSize={iconSize} fontFamily="system-ui, sans-serif">
              📞
            </text>
            {/* Caller name */}
            <text x={rowPad + iconSize + rowPad} y={rowH * 0.42} dominantBaseline="central"
              fill={col.text} fontSize={rowNameFs} fontWeight="600" fontFamily="system-ui, sans-serif">
              {calleeName}
            </text>
            <text x={rowPad + iconSize + rowPad} y={rowH * 0.78} dominantBaseline="central"
              fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              {!isGrayscale ? "Handset · HD" : "Handset"}
            </text>
            {/* Timer on right */}
            <text x={contentWidth} y={rowH / 2 + 1} textAnchor="end" dominantBaseline="central"
              fill={col.green} fontSize={rowTimerFs} fontWeight="600" fontFamily='"Geist Mono Variable", monospace'>
              {formatCallDuration(callSeconds)}
            </text>
            {/* Line info below */}
            <text y={rowH + Math.round(8 * s)} fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.green}>●</tspan>{" Line 1"}
            </text>
          </g>
        )}

        {/* ════════ HOLD ════════ */}
        {callPhase === "hold" && (
          <g>
            {/* Call entry row with amber tint */}
            <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
              rx={Math.round(2 * s)} fill="rgba(245,158,11,0.12)" />
            {/* Left accent */}
            <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
              rx={Math.round(1 * s)} fill={col.amber} />
            {/* Pause icon */}
            <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.amber} fontSize={iconSize} fontFamily="system-ui, sans-serif">
              ⏸
            </text>
            {/* Caller name */}
            <text x={rowPad + iconSize + rowPad} y={rowH * 0.42} dominantBaseline="central"
              fill={col.text} fontSize={rowNameFs} fontWeight="600" fontFamily="system-ui, sans-serif">
              {calleeName}
            </text>
            <text x={rowPad + iconSize + rowPad} y={rowH * 0.78} dominantBaseline="central"
              fill={col.amber} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              Hold
            </text>
            {/* Hold timer on right */}
            <text x={contentWidth} y={rowH / 2 + 1} textAnchor="end" dominantBaseline="central"
              fill={col.amber} fontSize={rowTimerFs} fontWeight="600" fontFamily='"Geist Mono Variable", monospace'>
              {formatCallDuration(holdSeconds)}
            </text>
            {/* Line info below */}
            <text y={rowH + Math.round(8 * s)} fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.amber}>●</tspan>{" Line 1 · Held"}
            </text>
          </g>
        )}

        {/* ════════ TRANSFER (legacy — kept for backwards compat) ════════ */}
        {callPhase === "transfer" && (
          <g>
            {/* Held call row (dimmed) */}
            <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
              rx={Math.round(2 * s)} fill="rgba(245,158,11,0.08)" opacity={0.6} />
            <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
              rx={Math.round(1 * s)} fill={col.amber} opacity={0.6} />
            <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.amber} fontSize={iconSize} fontFamily="system-ui, sans-serif" opacity={0.7}>
              ⏸
            </text>
            <text x={rowPad + iconSize + rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.textDim} fontSize={rowNameFs} fontFamily="system-ui, sans-serif">
              {calleeName}
            </text>
            <text x={contentWidth} y={rowH / 2 + 1} textAnchor="end" dominantBaseline="central"
              fill={col.amber} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              Held
            </text>

            {/* Transfer dial row */}
            <g transform={`translate(0, ${rowH + Math.round(4 * s)})`}>
              <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
                rx={Math.round(2 * s)} fill="rgba(192,132,252,0.1)" />
              <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
                rx={Math.round(1 * s)} fill={col.blue} />
              <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
                fill={col.blue} fontSize={iconSize} fontFamily="system-ui, sans-serif">
                ➜
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.42} dominantBaseline="central"
                fill={col.text} fontSize={rowNameFs} fontWeight="600" fontFamily="system-ui, sans-serif">
                Transfer to<AnimatedDots fontSize={rowNameFs} fill={col.textDim} />
              </text>
              <rect x={rowPad + iconSize + rowPad} y={rowH * 0.65}
                width={Math.max(1, 1.2 * s)} height={Math.round(5 * s)}
                fill={col.blue}>
                <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
              </rect>
            </g>

            <text y={rowH * 2 + Math.round(12 * s)} fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.blue}>●</tspan>{" Line 1"}
            </text>
          </g>
        )}

        {/* ════════ XFER DIALING — Held call + animated dial input ════════ */}
        {callPhase === "xfer_dialing" && (
          <g>
            {/* Held original call row (dimmed) */}
            <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
              rx={Math.round(2 * s)} fill="rgba(245,158,11,0.08)" opacity={0.6} />
            <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
              rx={Math.round(1 * s)} fill={col.amber} opacity={0.6} />
            <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.amber} fontSize={iconSize} fontFamily="system-ui, sans-serif" opacity={0.7}>
              ⏸
            </text>
            <text x={rowPad + iconSize + rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.textDim} fontSize={rowNameFs} fontFamily="system-ui, sans-serif">
              {calleeName}
            </text>
            <text x={contentWidth} y={rowH / 2 + 1} textAnchor="end" dominantBaseline="central"
              fill={col.amber} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              Held
            </text>

            {/* Active dial row — animated digit entry */}
            <g transform={`translate(0, ${rowH + Math.round(4 * s)})`}>
              <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
                rx={Math.round(2 * s)} fill="rgba(192,132,252,0.1)" />
              <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
                rx={Math.round(1 * s)} fill={col.blue} />
              <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
                fill={col.blue} fontSize={iconSize} fontFamily="system-ui, sans-serif">
                ➜
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.38} dominantBaseline="central"
                fill={col.text} fontSize={Math.max(7, Math.round(9.5 * s))} fontWeight="700" fontFamily='"Geist Mono Variable", monospace'
                letterSpacing={Math.round(1.5 * s)}>
                {dialingDigits}
              </text>
              {/* Blinking cursor */}
              {dialingDigits.length < dialTarget.length && (
                <rect x={rowPad + iconSize + rowPad + dialingDigits.length * Math.round(7 * s)} y={rowH * 0.2}
                  width={Math.max(1, 1.5 * s)} height={Math.round(7 * s)} fill={col.blue}>
                  <animate attributeName="opacity" values="1;0;1" dur="0.8s" repeatCount="indefinite" />
                </rect>
              )}
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.82} dominantBaseline="central"
                fill={col.blue} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
                Transfer to<AnimatedDots fontSize={rowInfoFs} fill={col.blue} />
              </text>
            </g>

            <text y={rowH * 2 + Math.round(12 * s)} fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.blue}>●</tspan>{" Line 1 · Transfer"}
            </text>
          </g>
        )}

        {/* ════════ XFER RINGING — Held call + ringing transfer target ════════ */}
        {callPhase === "xfer_ringing" && (
          <g>
            {/* Held original call row (dimmed) */}
            <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
              rx={Math.round(2 * s)} fill="rgba(245,158,11,0.08)" opacity={0.6} />
            <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
              rx={Math.round(1 * s)} fill={col.amber} opacity={0.6} />
            <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.amber} fontSize={iconSize} fontFamily="system-ui, sans-serif" opacity={0.7}>
              ⏸
            </text>
            <text x={rowPad + iconSize + rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.textDim} fontSize={rowNameFs} fontFamily="system-ui, sans-serif">
              {calleeName}
            </text>
            <text x={contentWidth} y={rowH / 2 + 1} textAnchor="end" dominantBaseline="central"
              fill={col.amber} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              Held
            </text>

            {/* Ringing transfer target row */}
            <g transform={`translate(0, ${rowH + Math.round(4 * s)})`}>
              <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
                rx={Math.round(2 * s)} fill="rgba(34,197,94,0.1)" />
              <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
                rx={Math.round(1 * s)} fill={col.green} />
              <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
                fill={col.green} fontSize={iconSize} fontFamily="system-ui, sans-serif">
                🔔
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.38} dominantBaseline="central"
                fill={col.text} fontSize={Math.max(7, Math.round(9.5 * s))} fontWeight="700" fontFamily='"Geist Mono Variable", monospace'
                letterSpacing={Math.round(1.5 * s)}>
                {dialTarget}
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.82} dominantBaseline="central"
                fill={col.green} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
                Ringing<AnimatedDots fontSize={rowInfoFs} fill={col.green} />
              </text>
            </g>

            <text y={rowH * 2 + Math.round(12 * s)} fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.blue}>●</tspan>{" Line 1 · Transfer"}
            </text>
          </g>
        )}

        {/* ════════ CONF DIALING — Held call + animated dial for 2nd party ════════ */}
        {callPhase === "conf_dialing" && (
          <g>
            {/* Held original call (dimmed) */}
            <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
              rx={Math.round(2 * s)} fill="rgba(245,158,11,0.08)" opacity={0.6} />
            <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
              rx={Math.round(1 * s)} fill={col.amber} opacity={0.6} />
            <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.amber} fontSize={iconSize} fontFamily="system-ui, sans-serif" opacity={0.7}>
              ⏸
            </text>
            <text x={rowPad + iconSize + rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.textDim} fontSize={rowNameFs} fontFamily="system-ui, sans-serif">
              {calleeName}
            </text>
            <text x={contentWidth} y={rowH / 2 + 1} textAnchor="end" dominantBaseline="central"
              fill={col.amber} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              Held
            </text>

            {/* Active dial row — dialing 2nd party */}
            <g transform={`translate(0, ${rowH + Math.round(4 * s)})`}>
              <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
                rx={Math.round(2 * s)} fill="rgba(192,132,252,0.1)" />
              <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
                rx={Math.round(1 * s)} fill={col.blue} />
              <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
                fill={col.blue} fontSize={iconSize} fontFamily="system-ui, sans-serif">
                ➜
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.38} dominantBaseline="central"
                fill={col.text} fontSize={Math.max(7, Math.round(9.5 * s))} fontWeight="700" fontFamily='"Geist Mono Variable", monospace'
                letterSpacing={Math.round(1.5 * s)}>
                {dialingDigits}
              </text>
              {dialingDigits.length < dialTarget.length && (
                <rect x={rowPad + iconSize + rowPad + dialingDigits.length * Math.round(7 * s)} y={rowH * 0.2}
                  width={Math.max(1, 1.5 * s)} height={Math.round(7 * s)} fill={col.blue}>
                  <animate attributeName="opacity" values="1;0;1" dur="0.8s" repeatCount="indefinite" />
                </rect>
              )}
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.82} dominantBaseline="central"
                fill={col.blue} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
                Conf invite<AnimatedDots fontSize={rowInfoFs} fill={col.blue} />
              </text>
            </g>

            <text y={rowH * 2 + Math.round(12 * s)} fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.blue}>●</tspan>{" Line 1 · Conference"}
            </text>
          </g>
        )}

        {/* ════════ CONF RINGING — Held call + ringing 2nd party ════════ */}
        {callPhase === "conf_ringing" && (
          <g>
            {/* Held original call */}
            <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
              rx={Math.round(2 * s)} fill="rgba(245,158,11,0.08)" opacity={0.6} />
            <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
              rx={Math.round(1 * s)} fill={col.amber} opacity={0.6} />
            <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.amber} fontSize={iconSize} fontFamily="system-ui, sans-serif" opacity={0.7}>
              ⏸
            </text>
            <text x={rowPad + iconSize + rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.textDim} fontSize={rowNameFs} fontFamily="system-ui, sans-serif">
              {calleeName}
            </text>
            <text x={contentWidth} y={rowH / 2 + 1} textAnchor="end" dominantBaseline="central"
              fill={col.amber} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              Held
            </text>

            {/* Ringing 2nd party */}
            <g transform={`translate(0, ${rowH + Math.round(4 * s)})`}>
              <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
                rx={Math.round(2 * s)} fill="rgba(34,197,94,0.1)" />
              <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
                rx={Math.round(1 * s)} fill={col.green} />
              <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
                fill={col.green} fontSize={iconSize} fontFamily="system-ui, sans-serif">
                🔔
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.38} dominantBaseline="central"
                fill={col.text} fontSize={Math.max(7, Math.round(9.5 * s))} fontWeight="700" fontFamily='"Geist Mono Variable", monospace'
                letterSpacing={Math.round(1.5 * s)}>
                {dialTarget}
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.82} dominantBaseline="central"
                fill={col.green} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
                Ringing<AnimatedDots fontSize={rowInfoFs} fill={col.green} />
              </text>
            </g>

            <text y={rowH * 2 + Math.round(12 * s)} fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.blue}>●</tspan>{" Line 1 · Conference"}
            </text>
          </g>
        )}

        {/* ════════ CONF CONNECTED — Held call + connected to 2nd party (before merge) ════════ */}
        {callPhase === "conf_connected" && (
          <g>
            {/* Held original call */}
            <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
              rx={Math.round(2 * s)} fill="rgba(245,158,11,0.08)" opacity={0.6} />
            <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
              rx={Math.round(1 * s)} fill={col.amber} opacity={0.6} />
            <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.amber} fontSize={iconSize} fontFamily="system-ui, sans-serif" opacity={0.7}>
              ⏸
            </text>
            <text x={rowPad + iconSize + rowPad} y={rowH / 2 + 1} dominantBaseline="central"
              fill={col.textDim} fontSize={rowNameFs} fontFamily="system-ui, sans-serif">
              {calleeName}
            </text>
            <text x={contentWidth} y={rowH / 2 + 1} textAnchor="end" dominantBaseline="central"
              fill={col.amber} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              Held
            </text>

            {/* Connected to 2nd party — about to merge */}
            <g transform={`translate(0, ${rowH + Math.round(4 * s)})`}>
              <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
                rx={Math.round(2 * s)} fill="rgba(34,197,94,0.08)" />
              <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
                rx={Math.round(1 * s)} fill={col.green} />
              <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
                fill={col.green} fontSize={iconSize} fontFamily="system-ui, sans-serif">
                📞
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.38} dominantBaseline="central"
                fill={col.text} fontSize={Math.max(7, Math.round(9.5 * s))} fontWeight="700" fontFamily='"Geist Mono Variable", monospace'
                letterSpacing={Math.round(1.5 * s)}>
                {dialTarget}
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH * 0.82} dominantBaseline="central"
                fill={col.green} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
                Connected · Merging<AnimatedDots fontSize={rowInfoFs} fill={col.green} />
              </text>
            </g>

            <text y={rowH * 2 + Math.round(12 * s)} fill={col.textDim} fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.green}>●</tspan>{" Line 1 · Conference"}
            </text>
          </g>
        )}

        {/* ════════ CONFERENCE (3-way merged) ════════ */}
        {callPhase === "conference" && (
          <g>
            {/* Header */}
            <text fill={col.text} fontSize={rowInfoFs} fontWeight="600" fontFamily="system-ui, sans-serif">
              Conference (3-way)
            </text>

            {/* Participant 1 row */}
            <g transform={`translate(0, ${Math.round(10 * s)})`}>
              <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
                rx={Math.round(2 * s)} fill="rgba(34,197,94,0.08)" />
              <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
                rx={Math.round(1 * s)} fill={col.green} />
              <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
                fill={col.green} fontSize={iconSize} fontFamily="system-ui, sans-serif">
                📞
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH / 2 + 1} dominantBaseline="central"
                fill={col.text} fontSize={rowNameFs} fontWeight="600" fontFamily="system-ui, sans-serif">
                {calleeName}
              </text>
            </g>

            {/* Participant 2 row — uses the dialed number */}
            <g transform={`translate(0, ${Math.round(10 * s) + rowH + Math.round(3 * s)})`}>
              <rect x={-rowPad} y={0} width={contentWidth + rowPad * 2} height={rowH}
                rx={Math.round(2 * s)} fill="rgba(34,197,94,0.08)" />
              <rect x={-rowPad} y={0} width={Math.max(1.5, 2 * s)} height={rowH}
                rx={Math.round(1 * s)} fill={col.green} />
              <text x={rowPad} y={rowH / 2 + 1} dominantBaseline="central"
                fill={col.green} fontSize={iconSize} fontFamily="system-ui, sans-serif">
                📞
              </text>
              <text x={rowPad + iconSize + rowPad} y={rowH / 2 + 1} dominantBaseline="central"
                fill={col.text} fontSize={rowNameFs} fontWeight="600" fontFamily='"Geist Mono Variable", monospace'>
                {dialTarget || "Party 2"}
              </text>
            </g>

            {/* Timer and line info */}
            <text y={Math.round(10 * s) + rowH * 2 + Math.round(14 * s)} fill={col.green}
              fontSize={rowTimerFs} fontWeight="600" fontFamily='"Geist Mono Variable", monospace'>
              {formatCallDuration(callSeconds)}
            </text>
            <text y={Math.round(10 * s) + rowH * 2 + Math.round(22 * s)} fill={col.textDim}
              fontSize={rowInfoFs} fontFamily="system-ui, sans-serif">
              <tspan fill={col.green}>●</tspan>{" Line 1"}
            </text>
          </g>
        )}

        {/* ════════ Custom softkey flash feedback ════════ */}
        {pressedSoftkey && callPhase !== "idle" && (
          <g transform={`translate(${contentWidth / 2}, ${Math.round(hasSoftkeyBar ? -8 * s : 60 * s)})`}>
            <rect x={-contentWidth * 0.35} y={-Math.round(5 * s)} width={contentWidth * 0.7} height={Math.round(10 * s)}
              rx={Math.round(3 * s)} fill="rgba(255,255,255,0.12)" />
            <text textAnchor="middle" dominantBaseline="central" fill={col.text}
              fontSize={rowInfoFs} fontWeight="600" fontFamily="system-ui, sans-serif">
              {pressedSoftkey}
            </text>
          </g>
        )}
      </g>

      {/* IP address (idle, bottom-left, above softkey bar) */}
      {callPhase === "idle" && networkIp && (
        <text
          x={x + pad}
          y={hasSoftkeyBar ? softkeyBarY - Math.round(3 * s) : y + height - Math.round(4 * s)}
          fill={col.textDim} fontSize={fs.ip} fontFamily='"Geist Mono Variable", monospace'
        >
          {networkIp}
        </text>
      )}

      {/* ── On-screen softkey label bar (bottom of LCD, like real Yealink) ── */}
      {hasSoftkeyBar && (
        <g clipPath={`url(#${clipId})`}>
          {/* Bar background */}
          <rect
            x={x} y={softkeyBarY}
            width={hasDssPanel ? width - dssKeyPanelWidth : width}
            height={softkeyBarH}
            fill="rgba(0,0,0,0.35)"
          />
          {/* Top divider line */}
          <line
            x1={x} y1={softkeyBarY}
            x2={x + (hasDssPanel ? width - dssKeyPanelWidth : width)} y2={softkeyBarY}
            stroke="rgba(255,255,255,0.08)" strokeWidth={0.5}
          />
          {/* Softkey labels — evenly spaced, with thin dividers */}
          {softkeyLabels.map((label, i) => {
            const barW = hasDssPanel ? width - dssKeyPanelWidth : width;
            const slotW = barW / softkeyLabels.length;
            const slotX = x + i * slotW;
            const isMoreKey = label === "More";
            const isDash = label === "—" || label === "-" || label === "";
            const isPressed = pressedSoftkey === label && !isDash;
            return (
              <g key={`sk-label-${i}`}>
                {/* Vertical divider */}
                {i > 0 && (
                  <line
                    x1={slotX} y1={softkeyBarY + Math.round(2 * s)}
                    x2={slotX} y2={softkeyBarY + softkeyBarH - Math.round(2 * s)}
                    stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}
                  />
                )}
                {/* Clickable label */}
                <g
                  onClick={!isDash && onSoftkeyClick ? () => onSoftkeyClick(label) : undefined}
                  style={!isDash && onSoftkeyClick ? { cursor: "pointer" } : undefined}
                >
                  {/* Hit area / pressed highlight */}
                  <rect
                    x={slotX} y={softkeyBarY}
                    width={slotW} height={softkeyBarH}
                    fill={isPressed ? "rgba(255,255,255,0.15)" : "transparent"}
                  />
                  <text
                    x={slotX + slotW / 2}
                    y={softkeyBarY + softkeyBarH / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={isDash ? "transparent"
                      : isPressed ? "#ffffff"
                      : isMoreKey ? "#8ab4f8"
                      : isGrayscale ? "#a0c0a0"
                      : "#b0c8b8"}
                    fontSize={fs.softkeyLabel}
                    fontWeight={isMoreKey || isPressed ? 600 : 400}
                    fontFamily="system-ui, sans-serif"
                    style={{ userSelect: "none" }}
                  >
                    {isMoreKey ? "More ▸" : isDash ? "" : truncateText(label, slotW - Math.round(4 * s), fs.softkeyLabel)}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function truncateText(text: string, maxWidth: number, fontSize: number): string {
  // Rough estimate: each character is about 0.6 * fontSize wide
  const charWidth = fontSize * 0.55;
  const maxChars = Math.floor(maxWidth / charWidth);
  
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}

// ============================================================================
// PHONE LAYOUT RENDERER
// ============================================================================

interface PhoneLayoutProps {
  modelId: string;
  mac: string;
  parsedEntries: KeyValue[] | null;
  inCall?: boolean;
  page: number;
  onPageChange?: (page: number) => void;
  wallpaperDataUrl?: string | null;
  onEndCall?: () => void;
}

type CallPhase =
  | "idle" | "dialing" | "ringing" | "connected" | "hold"
  | "transfer" | "conference"
  // Intermediate phases for realistic multi-step flows
  | "xfer_dialing" | "xfer_ringing"           // Transfer: dial → ring → complete
  | "conf_dialing" | "conf_ringing" | "conf_connected"; // Conference: dial → ring → 2nd connected → merge

// Fake extensions/numbers for animated dialing simulation
const FAKE_DIAL_NUMBERS = ["8201", "5503", "1147", "6042", "9318"];
function pickFakeNumber(): string {
  return FAKE_DIAL_NUMBERS[Math.floor(Math.random() * FAKE_DIAL_NUMBERS.length)] ?? "8201";
}

function PhoneLayout({ modelId, mac, parsedEntries, inCall = false, page, onPageChange, wallpaperDataUrl, onEndCall }: PhoneLayoutProps) {
  const layout = getDeviceLayout(modelId);
  const data = useDeviceViewData(parsedEntries, layout, inCall, page);
  const [softkeyPage, setSoftkeyPage] = useState(0);
  // Visual flash feedback when a custom/unknown softkey is pressed
  const [pressedSoftkey, setPressedSoftkey] = useState<string | null>(null);
  const pressedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Call phase state machine ──
  const [callPhase, setCallPhase] = useState<CallPhase>("idle");
  const [callSeconds, setCallSeconds] = useState(0);
  const [holdSeconds, setHoldSeconds] = useState(0);
  // Animated digit dialing — shows digits one by one
  const [dialingDigits, setDialingDigits] = useState("");
  const [dialTarget, setDialTarget] = useState("");        // full target number
  const dialIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Stores the callSeconds value when hold was entered so we can resume
  const frozenCallSecondsRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const callIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (callIntervalRef.current) { clearInterval(callIntervalRef.current); callIntervalRef.current = null; }
    if (holdIntervalRef.current) { clearInterval(holdIntervalRef.current); holdIntervalRef.current = null; }
    if (dialIntervalRef.current) { clearInterval(dialIntervalRef.current); dialIntervalRef.current = null; }
    if (pressedTimerRef.current) { clearTimeout(pressedTimerRef.current); pressedTimerRef.current = null; }
    setPressedSoftkey(null);
    setDialingDigits("");
  }, []);

  // Start call timer
  const startCallTimer = useCallback(() => {
    if (callIntervalRef.current) clearInterval(callIntervalRef.current);
    callIntervalRef.current = setInterval(() => setCallSeconds(s => s + 1), 1000);
  }, []);

  // Stop call timer (pause)
  const pauseCallTimer = useCallback(() => {
    if (callIntervalRef.current) { clearInterval(callIntervalRef.current); callIntervalRef.current = null; }
  }, []);

  // Start hold timer
  const startHoldTimer = useCallback(() => {
    setHoldSeconds(0);
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    holdIntervalRef.current = setInterval(() => setHoldSeconds(s => s + 1), 1000);
  }, []);

  // Stop hold timer
  const stopHoldTimer = useCallback(() => {
    if (holdIntervalRef.current) { clearInterval(holdIntervalRef.current); holdIntervalRef.current = null; }
  }, []);

  /**
   * Start an animated dialing sequence: types digits one by one, then transitions
   * through ringing → connected/completed phases.
   * `type` determines the flow: "xfer" or "conf"
   */
  const startDialSequence = useCallback((type: "xfer" | "conf") => {
    const number = pickFakeNumber();
    setDialTarget(number);
    setDialingDigits("");

    // Clear any pending transition timers and dial intervals
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (dialIntervalRef.current) clearInterval(dialIntervalRef.current);

    // Animate digits one at a time (every 300ms)
    let idx = 0;
    dialIntervalRef.current = setInterval(() => {
      idx++;
      if (idx <= number.length) {
        setDialingDigits(number.slice(0, idx));
      } else {
        // All digits typed — stop interval
        if (dialIntervalRef.current) { clearInterval(dialIntervalRef.current); dialIntervalRef.current = null; }
      }
    }, 300);

    // After digits finish typing (~300ms * length + 600ms pause), transition to ringing
    const dialDuration = number.length * 300 + 600;
    const ringPhase: CallPhase = type === "xfer" ? "xfer_ringing" : "conf_ringing";
    const t1 = setTimeout(() => setCallPhase(ringPhase), dialDuration);

    if (type === "xfer") {
      // Transfer flow: xfer_dialing → xfer_ringing → transfer completes → idle
      const t2 = setTimeout(() => {
        clearAllTimers();
        setCallPhase("idle");
        setCallSeconds(0);
        setHoldSeconds(0);
        onEndCall?.();
      }, dialDuration + 2500);
      timersRef.current.push(t1, t2);
    } else {
      // Conference flow: conf_dialing → conf_ringing → conf_connected → conference
      const t2 = setTimeout(() => setCallPhase("conf_connected"), dialDuration + 2000);
      const t3 = setTimeout(() => {
        setCallPhase("conference");
        setCallSeconds(frozenCallSecondsRef.current);
        startCallTimer();
      }, dialDuration + 3500);
      timersRef.current.push(t1, t2, t3);
    }
  }, [startCallTimer, onEndCall]);

  // ── inCall toggle drives the initial sequence (with animated digit dialing) ──
  useEffect(() => {
    if (inCall) {
      clearAllTimers();
      setCallPhase("dialing");
      setCallSeconds(0);
      setHoldSeconds(0);

      // Animate dialing a fake number
      const number = pickFakeNumber();
      setDialTarget(number);
      setDialingDigits("");
      let idx = 0;
      dialIntervalRef.current = setInterval(() => {
        idx++;
        if (idx <= number.length) {
          setDialingDigits(number.slice(0, idx));
        } else {
          if (dialIntervalRef.current) { clearInterval(dialIntervalRef.current); dialIntervalRef.current = null; }
        }
      }, 300);

      const dialDone = number.length * 300 + 500;
      const t1 = setTimeout(() => setCallPhase("ringing"), dialDone);
      const t2 = setTimeout(() => {
        setCallPhase("connected");
        setCallSeconds(0);
        startCallTimer();
      }, dialDone + 2500);

      timersRef.current = [t1, t2];
    } else {
      clearAllTimers();
      setCallPhase("idle");
      setCallSeconds(0);
      setHoldSeconds(0);
    }
    return clearAllTimers;
  }, [inCall, clearAllTimers, startCallTimer]);

  // Reset softkey page when phase changes
  useEffect(() => { setSoftkeyPage(0); }, [callPhase]);

  // ── Phase-specific softkey labels ──
  const softkeyCount = layout.softkeyCount;
  const fillTo = useCallback((labels: string[], count: number, includeMore: boolean = false): string[] => {
    const result = [...labels];
    const target = includeMore ? count - 1 : count;
    while (result.length < target) result.push("—");
    if (includeMore) result.push("More");
    return result.slice(0, count);
  }, []);

  const softkeyPagesForPhase = useCallback((phase: CallPhase): string[][] => {
    switch (phase) {
      case "idle":
        return data.idleSoftkeyPages;
      case "dialing":
      case "ringing":
        return [fillTo(["EndCall"], softkeyCount)];
      case "connected":
        return data.talkSoftkeyPages;
      case "hold":
        return [fillTo(["Resume", "NewCall", "EndCall"], softkeyCount)];
      case "transfer":
        return [fillTo(["Xfer", "Cancel"], softkeyCount)];
      case "xfer_dialing":
      case "xfer_ringing":
        return [fillTo(["Cancel", "EndCall"], softkeyCount)];
      case "conf_dialing":
      case "conf_ringing":
      case "conf_connected":
        return [fillTo(["Cancel", "EndCall"], softkeyCount)];
      case "conference":
        return [fillTo(["Split", "Hold", "EndCall"], softkeyCount)];
      default:
        return data.idleSoftkeyPages;
    }
  }, [data.idleSoftkeyPages, data.talkSoftkeyPages, softkeyCount, fillTo]);

  // ── Softkey action handler — drives state transitions ──
  const handleSoftkeyAction = useCallback((label: string) => {
    switch (label) {
      case "More":
        setSoftkeyPage(p => {
          const pages = softkeyPagesForPhase(callPhase);
          return (p + 1) % pages.length;
        });
        break;
      case "Hold":
        if (callPhase === "connected" || callPhase === "conference") {
          frozenCallSecondsRef.current = callSeconds;
          pauseCallTimer();
          startHoldTimer();
          setCallPhase("hold");
        }
        break;
      case "Resume":
        if (callPhase === "hold") {
          stopHoldTimer();
          setCallSeconds(frozenCallSecondsRef.current);
          startCallTimer();
          setCallPhase("connected");
        }
        break;
      case "Xfer":
        if (callPhase === "connected") {
          // Real Yealink: puts call on hold, shows dial screen
          frozenCallSecondsRef.current = callSeconds;
          pauseCallTimer();
          setCallPhase("xfer_dialing");
          startDialSequence("xfer");
        }
        break;
      case "Conf":
        if (callPhase === "connected") {
          // Real Yealink: puts call on hold, shows dial screen for 2nd party
          frozenCallSecondsRef.current = callSeconds;
          pauseCallTimer();
          setCallPhase("conf_dialing");
          startDialSequence("conf");
        }
        break;
      case "Split":
        if (callPhase === "conference") {
          // Split conference — go back to talking with first party
          setCallPhase("connected");
        }
        break;
      case "Cancel":
        if (callPhase === "transfer") {
          startCallTimer();
          setCallPhase("connected");
        }
        // Cancel during intermediate dialing phases — return to connected
        if (callPhase === "xfer_dialing" || callPhase === "xfer_ringing" ||
            callPhase === "conf_dialing" || callPhase === "conf_ringing" || callPhase === "conf_connected") {
          // Clear pending transition timers and dial animation
          timersRef.current.forEach(clearTimeout);
          timersRef.current = [];
          if (dialIntervalRef.current) { clearInterval(dialIntervalRef.current); dialIntervalRef.current = null; }
          setDialingDigits("");
          setCallSeconds(frozenCallSecondsRef.current);
          startCallTimer();
          setCallPhase("connected");
        }
        break;
      case "EndCall":
        clearAllTimers();
        setCallPhase("idle");
        setCallSeconds(0);
        setHoldSeconds(0);
        onEndCall?.();
        break;
      default: {
        // Custom/provisioned softkey — look up metadata for intelligent simulation
        if (callPhase === "idle" || label === "—" || label === "-" || label === "") break;

        const meta: SoftkeyMeta | undefined = data.softkeyMeta[label];

        if (meta && callPhase === "connected") {
          // Show flash feedback with the softkey label
          if (pressedTimerRef.current) clearTimeout(pressedTimerRef.current);
          setPressedSoftkey(label);
          pressedTimerRef.current = setTimeout(() => setPressedSoftkey(null), 800);

          switch (meta.behavior) {
            case "transfer":
              // Custom transfer key (e.g. "Xfer VM") — put call on hold, start transfer dial sequence
              frozenCallSecondsRef.current = callSeconds;
              pauseCallTimer();
              setCallPhase("xfer_dialing");
              startDialSequence("xfer");
              break;
            case "conference":
              // Custom conference key — put call on hold, start conference dial sequence
              frozenCallSecondsRef.current = callSeconds;
              pauseCallTimer();
              setCallPhase("conf_dialing");
              startDialSequence("conf");
              break;
            case "hold":
              frozenCallSecondsRef.current = callSeconds;
              pauseCallTimer();
              startHoldTimer();
              setCallPhase("hold");
              break;
            case "speed_dial":
            case "dtmf":
            case "unknown":
            default:
              // Unknown behavior — just show the flash feedback (already set above)
              break;
          }
        } else {
          // No metadata or not in connected phase — just flash feedback
          if (pressedTimerRef.current) clearTimeout(pressedTimerRef.current);
          setPressedSoftkey(label);
          pressedTimerRef.current = setTimeout(() => setPressedSoftkey(null), 800);
        }
        break;
      }
    }
  }, [callPhase, callSeconds, softkeyPagesForPhase, pauseCallTimer, startCallTimer, startHoldTimer, stopHoldTimer, clearAllTimers, onEndCall, startDialSequence, data.softkeyMeta]);

  const softkeyPages = softkeyPagesForPhase(callPhase);
  const currentSoftkeyPage = softkeyPages[softkeyPage % softkeyPages.length] ?? softkeyPages[0] ?? [];
  
  // Calculate dimensions based on layout — proportional to real screen ratios
  const hasLeftKeys = layout.lineKeyPosition === "both" || layout.lineKeyPosition === "left";
  const hasRightKeys = layout.lineKeyPosition === "both" || layout.lineKeyPosition === "right";
  const isTouchscreen = layout.lineKeyPosition === "touchscreen";
  const isGrayscale = layout.screenType === "grayscale";
  
  // Scale the screen so different models produce visibly different phone sizes.
  // Tiered scaling: small grayscale gets a slight boost so text stays legible,
  // large color screens expand more to show their detail.
  const rawArea = layout.screenWidth * layout.screenHeight;
  const SCALE = rawArea > 200000 ? 0.44  // large (800x480)
              : rawArea > 80000  ? 0.54  // medium (480x272)
              : rawArea > 40000  ? 0.62  // mid (320x240, 360x160)
              : 0.75;                     // tiny grayscale (132x64)
  const MIN_SCREEN_W = 110;
  const MIN_SCREEN_H = 50;
  const MAX_SCREEN_W = 360;
  const MAX_SCREEN_H = 230;
  
  const screenWidth = Math.min(MAX_SCREEN_W, Math.max(MIN_SCREEN_W, Math.round(layout.screenWidth * SCALE)));
  const screenHeight = Math.min(MAX_SCREEN_H, Math.max(MIN_SCREEN_H, Math.round(layout.screenHeight * SCALE)));
  
  // Scale everything proportionally via sizeRatio (baseline = T33G at ~200px wide)
  const sizeRatio = screenWidth / 200;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // Physical key button sizes — scale freely with sizeRatio
  const keyButtonWidth = Math.round(70 * clamp(sizeRatio, 0.6, 1.4));
  const keyButtonHeight = Math.round(24 * clamp(sizeRatio, 0.6, 1.4));
  const keyButtonGap = Math.round(5 * clamp(sizeRatio, 0.6, 1.4));
  const keyColumnWidth = keyButtonWidth + Math.round(16 * clamp(sizeRatio, 0.7, 1.2));

  const leftColumnWidth = hasLeftKeys ? keyColumnWidth : 0;
  const rightColumnWidth = hasRightKeys ? keyColumnWidth : 0;

  // Softkey dimensions
  const softkeyHeight = Math.round(18 * clamp(sizeRatio, 0.7, 1.3));
  const softkeyGap = Math.round(3 * clamp(sizeRatio, 0.8, 1.2));

  // Chassis padding scales with phone size
  const chassisPadding = Math.round(18 * clamp(sizeRatio, 0.7, 1.3));

  // ── Touchscreen DSS key panel (T48/T57W etc.) ──
  // On real touchscreen Yealink phones, DSS keys appear as a list on the right
  // side of the screen. We render them as a panel beside the main screen content.
  const touchKeysPerPage = isTouchscreen && layout.totalLineKeys > 0
    ? Math.ceil(layout.totalLineKeys / Math.max(1, layout.lineKeyPages))
    : 0;
  const touchPanelWidth = isTouchscreen && touchKeysPerPage > 0
    ? Math.round(screenWidth * 0.38) : 0;
  // Get current page of touch keys from full lineKeys array
  const touchPageKeys = isTouchscreen && touchKeysPerPage > 0
    ? data.lineKeys.slice((data.currentPage - 1) * touchKeysPerPage, data.currentPage * touchKeysPerPage)
    : [];

  const totalWidth = leftColumnWidth + screenWidth + rightColumnWidth + chassisPadding * 2;
  const keysAreaHeight = layout.keysPerSide * (keyButtonHeight + keyButtonGap);
  // Touchscreen models don't render physical softkey buttons below the screen
  const physicalSoftkeyArea = isTouchscreen ? 0 : (Math.round(8 * sizeRatio) + softkeyHeight + Math.round(18 * sizeRatio));
  const screenAreaHeight = screenHeight + physicalSoftkeyArea;
  const totalHeight = Math.max(screenAreaHeight + chassisPadding * 2, keysAreaHeight + chassisPadding * 2 + 16);

  const screenX = leftColumnWidth + chassisPadding;
  const screenY = chassisPadding;

  const softkeyWidth = (screenWidth - (layout.softkeyCount - 1) * softkeyGap) / layout.softkeyCount;
  const softkeyY = screenY + screenHeight + Math.round(8 * sizeRatio);

  // Line key positions — vertically centered in the chassis
  const keysPerSide = layout.keysPerSide;
  const totalKeysHeight = keysPerSide * (keyButtonHeight + keyButtonGap) - keyButtonGap;
  const keyStartY = Math.max(screenY, (totalHeight - totalKeysHeight) / 2);
  // Center keys within their allocated column areas
  const leftKeyX = hasLeftKeys ? (leftColumnWidth - keyButtonWidth) / 2 : 0;
  const rightKeyX = leftColumnWidth + chassisPadding * 2 + screenWidth + (rightColumnWidth - keyButtonWidth) / 2;

  // Split keys for left/right sides
  const leftKeys = hasLeftKeys && !hasRightKeys 
    ? data.currentPageLineKeys 
    : data.currentPageLineKeys.slice(0, keysPerSide);
  const rightKeys = hasRightKeys && !hasLeftKeys
    ? data.currentPageLineKeys
    : data.currentPageLineKeys.slice(keysPerSide, keysPerSide * 2);
  
  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      className="w-full"
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
    >
      {/* Phone chassis */}
      <rect
        x={0}
        y={0}
        width={totalWidth}
        height={totalHeight}
        rx={12}
        fill={COLORS.chassis}
      />
      <rect
        x={2}
        y={2}
        width={totalWidth - 4}
        height={totalHeight - 4}
        rx={10}
        fill="none"
        stroke={COLORS.chassisHighlight}
        strokeWidth={1}
      />
      
      {/* Screen */}
      <Screen
        x={screenX}
        y={screenY}
        width={screenWidth}
        height={screenHeight}
        modelName={layout.name}
        mac={mac || data.macAddress}
        timeStr={data.timeStr}
        dateStr={data.dateStr}
        accounts={data.accounts}
        networkIp={data.networkIp}
        inCall={inCall}
        callPhase={callPhase}
        callSeconds={callSeconds}
        holdSeconds={holdSeconds}
        wallpaperUrl={wallpaperDataUrl || data.wallpaperUrl}
        isGrayscale={isGrayscale}
        dssKeyPanelWidth={touchPanelWidth}
        softkeyLabels={currentSoftkeyPage}
        onSoftkeyClick={handleSoftkeyAction}
        pressedSoftkey={pressedSoftkey}
        dialingDigits={dialingDigits}
        dialTarget={dialTarget}
      />
      
      {/* ── Touchscreen DSS key panel (rendered inside the screen area) ── */}
      {isTouchscreen && touchPageKeys.length > 0 && callPhase === "idle" && (() => {
        const panelX = screenX + screenWidth - touchPanelWidth;
        const panelY = screenY;
        const panelH = screenHeight;
        const tkPad = Math.round(4 * sizeRatio);
        const hasMultiPages = data.totalPages > 1;
        // Reserve space for page nav header when there are multiple pages
        const navBarH = hasMultiPages ? Math.round(14 * sizeRatio) : 0;
        const keyAreaY = panelY + tkPad + navBarH;
        const keyAreaH = panelH - tkPad * 2 - navBarH;
        const tkH = Math.max(14, Math.round(keyAreaH / Math.max(touchPageKeys.length, 1) - 1));
        const tkGap = 1;
        const tkLedR = Math.max(2, Math.round(2.5 * sizeRatio));
        const tkFs = Math.max(5, Math.min(9, tkH * 0.42));
        const tkTypeFs = Math.max(3.5, Math.min(6, tkH * 0.28));
        const tkTextX = panelX + tkPad + tkLedR * 2 + Math.round(5 * sizeRatio);
        const tkTextMaxW = touchPanelWidth - tkPad * 2 - tkLedR * 3 - Math.round(4 * sizeRatio);
        const navFs = Math.max(4, Math.round(5 * sizeRatio));
        const arrowFs = Math.max(5, Math.round(7 * sizeRatio));
        const navCenterX = panelX + touchPanelWidth / 2;
        const navY = panelY + tkPad + navBarH * 0.65;
        return (
          <g clipPath={`url(#screen-clip-${screenX}-${screenY})`}>
            {/* Solid dark panel background */}
            <rect
              x={panelX} y={panelY}
              width={touchPanelWidth} height={panelH}
              fill="rgba(10,14,18,0.85)"
            />
            {/* Left edge highlight */}
            <line
              x1={panelX} y1={panelY}
              x2={panelX} y2={panelY + panelH}
              stroke="rgba(255,255,255,0.1)" strokeWidth={1}
            />

            {/* ── Page navigation header ── */}
            {hasMultiPages && (
              <g>
                {/* Prev arrow */}
                <text
                  x={panelX + tkPad + 2}
                  y={navY}
                  fill={data.currentPage > 1 ? "#8ab898" : "rgba(255,255,255,0.15)"}
                  fontSize={arrowFs}
                  fontFamily="system-ui, sans-serif"
                  dominantBaseline="middle"
                  style={{ cursor: data.currentPage > 1 ? "pointer" : "default" }}
                  onClick={() => { if (data.currentPage > 1 && onPageChange) onPageChange(data.currentPage - 1); }}
                >
                  ◂
                </text>
                {/* Page indicator */}
                <text
                  x={navCenterX}
                  y={navY}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.45)"
                  fontSize={navFs}
                  fontFamily="system-ui, sans-serif"
                  dominantBaseline="middle"
                >
                  {data.currentPage}/{data.totalPages}
                </text>
                {/* Next arrow */}
                <text
                  x={panelX + touchPanelWidth - tkPad - 2}
                  y={navY}
                  textAnchor="end"
                  fill={data.currentPage < data.totalPages ? "#8ab898" : "rgba(255,255,255,0.15)"}
                  fontSize={arrowFs}
                  fontFamily="system-ui, sans-serif"
                  dominantBaseline="middle"
                  style={{ cursor: data.currentPage < data.totalPages ? "pointer" : "default" }}
                  onClick={() => { if (data.currentPage < data.totalPages && onPageChange) onPageChange(data.currentPage + 1); }}
                >
                  ▸
                </text>
                {/* Divider below nav */}
                <line
                  x1={panelX + tkPad} y1={keyAreaY - 1}
                  x2={panelX + touchPanelWidth - tkPad} y2={keyAreaY - 1}
                  stroke="rgba(255,255,255,0.08)" strokeWidth={0.5}
                />
              </g>
            )}

            {/* DSS key entries */}
            {touchPageKeys.map((key, i) => {
              const ky = keyAreaY + i * (tkH + tkGap);
              const ledColor = key.ledStatus === "green" ? COLORS.ledGreen
                : key.ledStatus === "red" ? COLORS.ledRed
                : key.ledStatus === "blinking" ? COLORS.ledGreen
                : COLORS.ledOff;
              return (
                <g key={`tk-${key.index}`}>
                  {/* Row separator line */}
                  {i > 0 && (
                    <line
                      x1={panelX + tkPad} y1={ky - tkGap}
                      x2={panelX + touchPanelWidth - tkPad} y2={ky - tkGap}
                      stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}
                    />
                  )}
                  {/* Row background */}
                  <rect
                    x={panelX + 2} y={ky}
                    width={touchPanelWidth - 4} height={tkH}
                    rx={2}
                    fill={key.isConfigured ? "rgba(255,255,255,0.05)" : "transparent"}
                  />
                  {/* LED dot */}
                  <circle
                    cx={panelX + tkPad + tkLedR}
                    cy={ky + tkH / 2}
                    r={tkLedR}
                    fill={ledColor}
                  />
                  {/* Key label */}
                  <text
                    x={tkTextX}
                    y={tkH >= 18 ? ky + tkH * 0.38 : ky + tkH / 2}
                    fill={key.isConfigured ? "#d0e0d0" : COLORS.screenTextDim}
                    fontSize={tkFs}
                    fontFamily="system-ui, sans-serif"
                    dominantBaseline="middle"
                  >
                    {truncateText(key.displayLabel, tkTextMaxW, tkFs)}
                  </text>
                  {/* Type label */}
                  {key.isConfigured && key.type !== 15 && tkH >= 18 && (
                    <text
                      x={tkTextX}
                      y={ky + tkH * 0.74}
                      fill="#5a8068"
                      fontSize={tkTypeFs}
                      fontFamily="system-ui, sans-serif"
                      dominantBaseline="middle"
                    >
                      {key.typeShortName}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })()}

      {/* ── Page tabs for physical line keys (rendered on the chassis above keys) ── */}
      {!isTouchscreen && data.totalPages > 1 && (() => {
        const tabW = Math.round(14 * sizeRatio);
        const tabH = Math.round(10 * sizeRatio);
        const tabGap = Math.round(2 * sizeRatio);
        const tabCount = data.totalPages;
        const tabTotalW = tabCount * tabW + (tabCount - 1) * tabGap;
        const tabFs = Math.max(4, Math.round(5.5 * sizeRatio));
        // Position: above the left key column, or above the screen if no side keys
        const tabX = hasLeftKeys
          ? leftKeyX + keyButtonWidth / 2 - tabTotalW / 2
          : hasRightKeys
            ? rightKeyX + keyButtonWidth / 2 - tabTotalW / 2
            : screenX + screenWidth / 2 - tabTotalW / 2;
        const tabY = keyStartY - tabH - Math.round(4 * sizeRatio);
        return (
          <g>
            {Array.from({ length: tabCount }, (_, i) => {
              const pageNum = i + 1;
              const tx = tabX + i * (tabW + tabGap);
              const isActive = pageNum === data.currentPage;
              return (
                <g
                  key={`page-tab-${pageNum}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => onPageChange?.(pageNum)}
                >
                  <rect
                    x={tx} y={tabY}
                    width={tabW} height={tabH}
                    rx={Math.round(2 * sizeRatio)}
                    fill={isActive ? "rgba(34,197,94,0.25)" : COLORS.button}
                    stroke={isActive ? "rgba(34,197,94,0.5)" : COLORS.buttonBorder}
                    strokeWidth={isActive ? 1 : 0.5}
                  />
                  <text
                    x={tx + tabW / 2}
                    y={tabY + tabH / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={isActive ? "#22c55e" : COLORS.buttonTextDim}
                    fontSize={tabFs}
                    fontWeight={isActive ? "600" : "400"}
                    fontFamily="system-ui, sans-serif"
                  >
                    {pageNum}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })()}

      {/* Also render page tabs above right column if both sides have keys */}
      {!isTouchscreen && data.totalPages > 1 && hasLeftKeys && hasRightKeys && (() => {
        const tabW = Math.round(14 * sizeRatio);
        const tabH = Math.round(10 * sizeRatio);
        const tabGap = Math.round(2 * sizeRatio);
        const tabCount = data.totalPages;
        const tabTotalW = tabCount * tabW + (tabCount - 1) * tabGap;
        const tabFs = Math.max(4, Math.round(5.5 * sizeRatio));
        const tabX = rightKeyX + keyButtonWidth / 2 - tabTotalW / 2;
        const tabY = keyStartY - tabH - Math.round(4 * sizeRatio);
        return (
          <g>
            {Array.from({ length: tabCount }, (_, i) => {
              const pageNum = i + 1;
              const tx = tabX + i * (tabW + tabGap);
              const isActive = pageNum === data.currentPage;
              return (
                <g
                  key={`page-tab-r-${pageNum}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => onPageChange?.(pageNum)}
                >
                  <rect
                    x={tx} y={tabY}
                    width={tabW} height={tabH}
                    rx={Math.round(2 * sizeRatio)}
                    fill={isActive ? "rgba(34,197,94,0.25)" : COLORS.button}
                    stroke={isActive ? "rgba(34,197,94,0.5)" : COLORS.buttonBorder}
                    strokeWidth={isActive ? 1 : 0.5}
                  />
                  <text
                    x={tx + tabW / 2}
                    y={tabY + tabH / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={isActive ? "#22c55e" : COLORS.buttonTextDim}
                    fontSize={tabFs}
                    fontWeight={isActive ? "600" : "400"}
                    fontFamily="system-ui, sans-serif"
                  >
                    {pageNum}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })()}

      {/* Left side line keys */}
      {hasLeftKeys && leftKeys.map((key, i) => (
        <LineKeyButton
          key={`left-${key.index}`}
          config={key}
          x={leftKeyX}
          y={keyStartY + i * (keyButtonHeight + keyButtonGap)}
          width={keyButtonWidth}
          height={keyButtonHeight}
          ledPosition="left"
        />
      ))}
      
      {/* Right side line keys */}
      {hasRightKeys && rightKeys.map((key, i) => (
        <LineKeyButton
          key={`right-${key.index}`}
          config={key}
          x={rightKeyX}
          y={keyStartY + i * (keyButtonHeight + keyButtonGap)}
          width={keyButtonWidth}
          height={keyButtonHeight}
          ledPosition="right"
        />
      ))}
      
      {/* Physical softkey buttons — only for non-touchscreen models.
          Touchscreen models (T48U, T48S, T57W, etc.) have on-screen softkeys
          without dedicated physical buttons below the display. */}
      {!isTouchscreen && currentSoftkeyPage.map((label, i) => {
        const isDash = label === "—" || label === "-" || label === "";
        const btn = (
          <SoftkeyButton
            x={screenX + i * (softkeyWidth + softkeyGap)}
            y={softkeyY}
            width={softkeyWidth}
            height={softkeyHeight}
            onClick={!isDash ? () => handleSoftkeyAction(label) : undefined}
          />
        );
        const key = `softkey-${softkeyPage}-${i}`;
        return isDash ? <Fragment key={key}>{btn}</Fragment> : (
          <TooltipWrapper key={key} title={label} description={`Press ${label} softkey.`}>
            {btn}
          </TooltipWrapper>
        );
      })}
    </svg>
  );
}

// ============================================================================
// MAIN DEVICE VIEW COMPONENT
// ============================================================================

export function DeviceView({
  modelId,
  mac,
  parsedEntries,
  inCall = false,
  className,
  onEndCall,
}: {
  modelId: string;
  mac: string;
  parsedEntries: KeyValue[] | null;
  inCall?: boolean;
  className?: string;
  onEndCall?: () => void;
}) {
  const layout = getDeviceLayout(modelId);
  const [page, setPage] = useState(1);
  const data = useDeviceViewData(parsedEntries, layout, inCall, page);
  const wallpaperDataUrl = useWallpaperDataUrl(data.wallpaperUrl);

  // ── Sidecar ──────────────────────────────────────────────────────────────
  const supportsSidecar = modelSupportsSidecar(modelId);
  const sidecarData = useSidecarData(parsedEntries, modelId, layout);
  const [sidecarVisible, setSidecarVisible] = useState(false);
  const sidecarUnitsToRender = useMemo<SidecarUnit[]>(() => {
    if (sidecarData.units.length > 0) return sidecarData.units;
    if (!sidecarData.sidecarLayout || !sidecarVisible) return [];
    // Manual toggle fallback: render an empty module so users can still inspect sidecar layout.
    const keys: LineKeyConfig[] = Array.from({ length: sidecarData.sidecarLayout.totalKeys }, (_, i) => ({
      index: i + 1,
      type: 0,
      typeName: "N/A",
      typeShortName: "—",
      line: 1,
      value: "",
      label: "",
      extension: "",
      displayLabel: "—",
      isConfigured: false,
      ledStatus: "off",
    }));
    return [{
      unitIndex: 1,
      layout: sidecarData.sidecarLayout,
      keys,
      configuredCount: 0,
    }];
  }, [sidecarData.units, sidecarData.sidecarLayout, sidecarVisible]);
  // Track whether the user has manually toggled the sidecar so we don't fight them
  const [userToggled, setUserToggled] = useState(false);

  // Auto-show/hide sidecar when config changes (only if user hasn't manually toggled)
  useEffect(() => {
    if (userToggled) return;
    // Show whenever the config contains linekeys beyond the phone's native count
    setSidecarVisible(sidecarData.autoDetected);
  }, [sidecarData.autoDetected, userToggled]);

  // Reset user toggle when parsedEntries change (new config loaded)
  const entriesRef = useRef(parsedEntries);
  useEffect(() => {
    if (parsedEntries !== entriesRef.current) {
      entriesRef.current = parsedEntries;
      setUserToggled(false);
    }
  }, [parsedEntries]);

  return (
    <div className={cn("flex flex-col gap-4 w-full", className)}>
      {/* Sidecar toggle — only for models that support expansion modules */}
      {supportsSidecar && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              setUserToggled(true);
              setSidecarVisible((v) => !v);
            }}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)] border",
              sidecarVisible
                ? "bg-info/15 text-info border-info/30 hover:bg-info/25"
                : "bg-muted/50 text-muted-foreground border-border/50 hover:bg-muted hover:text-foreground"
            )}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9zM3.5 3a.5.5 0 00-.5.5v9a.5.5 0 00.5.5H6V3H3.5zM7 3v10h5.5a.5.5 0 00.5-.5v-9a.5.5 0 00-.5-.5H7z" />
            </svg>
            {sidecarVisible ? "Hide Sidecar" : "Show Sidecar"}
            {sidecarData.totalConfiguredKeys > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-info/20 text-2xs font-semibold text-info">
                {sidecarData.totalConfiguredKeys} keys detected
              </span>
            )}
          </button>
          {sidecarData.sidecarLayout && (
            <span className="text-2xs text-muted-foreground/60">
              {sidecarData.sidecarLayout.name}
            </span>
          )}
        </div>
      )}

      {/* Phone + sidecar layout */}
      <div className={cn(
        "w-full mx-auto flex justify-center gap-4",
        sidecarVisible ? "max-w-6xl" : "max-w-3xl"
      )}>
        {/* Phone mockup */}
        <div className={cn(
          sidecarVisible ? "flex-[3] min-w-0" : "w-full"
        )}>
          <PhoneLayout
            modelId={modelId}
            mac={mac}
            parsedEntries={parsedEntries}
            inCall={inCall}
            page={page}
            onPageChange={setPage}
            wallpaperDataUrl={wallpaperDataUrl}
            onEndCall={onEndCall}
          />
        </div>

        {/* Sidecar mockup(s) — proportional to the phone */}
        {sidecarVisible && sidecarUnitsToRender.length > 0 && (
          <div className={cn(
            "min-w-0",
            sidecarUnitsToRender.length === 1 ? "flex-[1.2]" : "flex-[2]"
          )}>
            <SidecarMockup units={sidecarUnitsToRender} />
          </div>
        )}
      </div>

      {/* Compact summary */}
      <p className="text-xs text-muted-foreground text-center">
        {data.lineKeys.filter(k => k.isConfigured).length}/{layout.totalLineKeys} line keys configured
        {sidecarVisible && sidecarData.totalConfiguredKeys > 0 && (
          <> {" · "} {sidecarData.totalConfiguredKeys} sidecar keys</>
        )}
        {" · "}
        {data.accounts.filter(a => a.isRegistered).length} accounts
      </p>
    </div>
  );
}
